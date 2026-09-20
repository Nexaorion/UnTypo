import { Menu, app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { userInfo } from 'node:os';
import path from 'node:path';
import { DIAGNOSTIC_CHANGED_CHANNEL } from '../shared/diagnostics.js';
import { IPC_CHANNELS, type PingResponse } from '../shared/client-ipc.js';
import { hideMainWindowOnClose, keepDarwinDockVisible } from './platform/darwin-dock.js';
import { DiagnosticCollector } from './diagnostics/collector.js';
import { ClientIpcController } from './ipc/handler.js';
import { handleAppScheme, registerAppScheme } from './platform/app-protocol.js';
import { runRendererSmokeTest } from './testing/renderer-smoke.js';
import { DesktopRuntime } from './runtime/app-runtime.js';
import { assertTrustedSender } from './ipc/security.js';
import {
  captureTelemetryException,
  flushSentryTelemetry,
  initSentryTelemetryBeforeReady,
} from './telemetry/crash-reporter.js';

initSentryTelemetryBeforeReady();
registerAppScheme();
app.enableSandbox();
app.setName('UnTypo');

const isSmokeTest = process.argv.includes('--smoke-test');
let isQuitting = false;
let clientIpc: ClientIpcController | undefined;
let diagnostics: DiagnosticCollector | undefined;
let mainWindow: BrowserWindow | undefined;
let removeDiagnosticsListener: (() => void) | undefined;
let runtime: DesktopRuntime | undefined;

process.on('uncaughtExceptionMonitor', (error) => {
  captureTelemetryException(error);
  diagnostics?.recordIssue({
    error,
    kind: 'internal',
    source: 'process.uncaught-exception',
  });
});

process.on('unhandledRejection', (reason) => {
  captureTelemetryException(reason);
  diagnostics?.recordIssue({
    error: reason,
    kind: 'internal',
    source: 'process.unhandled-rejection',
  });
});

app.on('render-process-gone', (_event, webContents, details) => {
  if (isQuitting || details.reason === 'clean-exit') return;
  const url = webContents.getURL();
  const surface = url.includes('recorder.html')
    ? 'recorder'
    : url.includes('status-overlay.html')
      ? 'status-overlay'
      : 'main';
  captureTelemetryException(new Error(`Renderer process terminated: ${details.reason}`), {
    'exit.code': String(details.exitCode),
    'exit.reason': details.reason,
    surface,
  });
  diagnostics?.recordIssue({
    context: { exitCode: details.exitCode, reason: details.reason, surface },
    error: new Error(`Renderer process terminated: ${details.reason}`),
    kind: 'renderer',
    source: 'renderer.process',
  });
});

app.on('child-process-gone', (_event, details) => {
  if (isQuitting || details.reason === 'clean-exit') return;
  captureTelemetryException(new Error(`${details.type} process terminated: ${details.reason}`), {
    'exit.code': String(details.exitCode),
    'exit.reason': details.reason,
    'process.name': details.name ?? '',
    'process.type': details.type,
  });
  diagnostics?.recordIssue({
    context: {
      exitCode: details.exitCode,
      name: details.name,
      reason: details.reason,
      serviceName: details.serviceName,
      type: details.type,
    },
    error: new Error(`${details.type} process terminated: ${details.reason}`),
    kind: 'internal',
    source: 'app.child-process',
  });
});

const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#111111' : '#ffffff');

const applicationIconPath = (): string => {
  const fileName = process.platform === 'darwin' ? 'untypo-icon.png' : 'untypo-icon.ico';
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(app.getAppPath(), 'assets', fileName);
};

const installApplicationMenu = (): void => {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
};

const createMainWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    backgroundColor: windowBackground(),
    height: 760,
    icon: applicationIconPath(),
    minHeight: 600,
    minWidth: 860,
    show: !isSmokeTest,
    title: 'UnTypo',
    width: 1120,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });

  if (process.platform === 'darwin') {
    installApplicationMenu();
  } else {
    window.removeMenu();
  }
  const syncWindowBackground = () => window.setBackgroundColor(windowBackground());
  nativeTheme.on('updated', syncWindowBackground);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadURL('app://renderer/index.html');
  }
  diagnostics?.log({
    message: 'Main application window loaded',
    scope: 'renderer.window',
  });

  window.on('close', (event) => {
    hideMainWindowOnClose(event, window, { isQuitting, isSmokeTest });
  });
  window.once('closed', () => {
    nativeTheme.off('updated', syncWindowBackground);
    if (mainWindow === window) mainWindow = undefined;
  });

  return window;
};

let settleMainIpcReady!: (error?: unknown) => void;
const whenMainIpcReady = new Promise<void>((resolve, reject) => {
  settleMainIpcReady = (error?: unknown) => {
    if (error === undefined) {
      resolve();
      return;
    }
    reject(error instanceof Error ? error : new Error('Application startup failed'));
  };
});
void whenMainIpcReady.catch(() => undefined);

let openingMainWindow: Promise<BrowserWindow> | undefined;

const ensureMainWindow = async (): Promise<BrowserWindow> => {
  await whenMainIpcReady;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  openingMainWindow ??= createMainWindow()
    .then((window) => {
      mainWindow = window;
      return window;
    })
    .finally(() => {
      openingMainWindow = undefined;
    });
  return openingMainWindow;
};

const showMainWindow = async (): Promise<void> => {
  try {
    const window = await ensureMainWindow();
    if (isQuitting || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } catch (error) {
    if (!isQuitting) console.error(error);
  }
};

const startPrimaryInstance = (): void => {
  if (!isSmokeTest) {
    app.on('second-instance', () => {
      void showMainWindow();
    });
  }

  ipcMain.handle(IPC_CHANNELS.ping, (event): PingResponse => {
    assertTrustedSender(event);
    return {
      appName: app.getName(),
      platform: process.platform,
      userName: userInfo().username,
      version: app.getVersion(),
    };
  });

  void app
    .whenReady()
    .then(async () => {
      handleAppScheme();
      diagnostics = new DiagnosticCollector({
        appName: app.getName(),
        appVersion: app.getVersion(),
        rootDirectory: path.join(app.getPath('userData'), 'diagnostics'),
      });
      removeDiagnosticsListener = diagnostics.onChanged(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(DIAGNOSTIC_CHANGED_CHANNEL);
      });
      runtime = new DesktopRuntime({
        applicationIconPath: applicationIconPath(),
        diagnostics,
        onSnapshotChanged: (snapshot) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.webContents.send(IPC_CHANNELS.snapshotChanged, snapshot);
        },
        onUpdateChanged: (snapshot) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.webContents.send(IPC_CHANNELS.updateChanged, snapshot);
        },
        showMainWindow,
      });
      await runtime.start();
      keepDarwinDockVisible({ isQuitting });
      // Handlers must exist before the renderer's first snapshot request.
      clientIpc = new ClientIpcController(runtime);
      settleMainIpcReady();
      mainWindow = await ensureMainWindow();

      if (isSmokeTest) {
        const [result, recorderReady, rendererReady] = await Promise.all([
          mainWindow.webContents.executeJavaScript(
            'window.untypo?.ping()',
          ) as Promise<PingResponse>,
          runtime.smokeTest(),
          runRendererSmokeTest(mainWindow.webContents),
        ]);
        if (!recorderReady) throw new Error('Runtime smoke surfaces are unavailable');
        if (rendererReady !== 'ok')
          throw new Error(`Renderer interactions failed at ${rendererReady}`);
        await runtime.selectionSmokeTest();
        console.log(
          `SMOKE_OK ${result.appName} ${result.version} ${result.platform} recorder native ui`,
        );
        clientIpc.destroy();
        clientIpc = undefined;
        await runtime.stop();
        mainWindow.destroy();
        app.exit(0);
        return;
      }

      app.on('activate', () => {
        void showMainWindow();
      });
    })
    .catch((error: unknown) => {
      settleMainIpcReady(error);
      clientIpc?.destroy();
      captureTelemetryException(error);
      diagnostics?.recordIssue({
        error,
        kind: 'internal',
        source: 'app.startup',
      });
      console.error(error);
      app.exit(1);
    });

  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    const installUpdate = runtime?.isUpdateReady() === true;
    clientIpc?.destroy();
    clientIpc = undefined;
    removeDiagnosticsListener?.();
    removeDiagnosticsListener = undefined;
    const stopping = runtime ? runtime.stop().catch(console.error) : Promise.resolve();
    void stopping
      .catch(console.error)
      .finally(() => flushSentryTelemetry().catch(() => undefined))
      .then(() => {
        if (installUpdate) {
          try {
            runtime?.quitAndInstallUpdate();
            return;
          } catch (error) {
            console.error(error);
          }
        }
        app.exit(0);
      });
  });
};

const isPrimaryInstance = isSmokeTest || app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  startPrimaryInstance();
}
