import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc.js';
import { handleAppScheme, registerAppScheme } from './protocol.js';
import { DesktopRuntime } from './runtime/desktop-runtime.js';
import { assertTrustedSender } from './security.js';

registerAppScheme();
app.enableSandbox();
app.setName('UnTypo');

const isSmokeTest = process.argv.includes('--smoke-test');
let isQuitting = false;
let mainWindow: BrowserWindow | undefined;
let runtime: DesktopRuntime | undefined;

const createMainWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    backgroundColor: '#070b14',
    height: 760,
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

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadURL('app://renderer/index.html');
  }

  window.on('close', (event) => {
    if (isQuitting || isSmokeTest) return;
    event.preventDefault();
    window.hide();
  });
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  return window;
};

const showMainWindow = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = await createMainWindow();
  }
  mainWindow.show();
  mainWindow.focus();
};

ipcMain.handle(IPC_CHANNELS.ping, (event): PingResponse => {
  assertTrustedSender(event);
  return {
    appName: app.getName(),
    platform: process.platform,
    version: app.getVersion(),
  };
});

void app
  .whenReady()
  .then(async () => {
    handleAppScheme();
    mainWindow = await createMainWindow();
    runtime = new DesktopRuntime({ showMainWindow });
    await runtime.start();

    if (isSmokeTest) {
      const [result, recorderReady] = await Promise.all([
        mainWindow.webContents.executeJavaScript(
          'window.untypo.ping()',
        ) as Promise<PingResponse>,
        runtime.smokeTest(),
      ]);
      if (!recorderReady)
        throw new Error('Recorder preload bridge is unavailable');
      console.log(
        `SMOKE_OK ${result.appName} ${result.version} ${result.platform} recorder native`,
      );
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
    console.error(error);
    app.exit(1);
  });

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const stopping = runtime
    ? runtime.stop().catch(console.error)
    : Promise.resolve();
  void stopping.catch(console.error).finally(() => app.exit(0));
});
