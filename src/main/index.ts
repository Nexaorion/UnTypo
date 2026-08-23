import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS, type PingResponse } from '../shared/ipc.js';
import { handleAppScheme, registerAppScheme } from './protocol.js';
import { RecorderWindowController } from './recording/recorder-window.js';
import { assertTrustedSender } from './security.js';

registerAppScheme();
app.enableSandbox();

const isSmokeTest = process.argv.includes('--smoke-test');

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

  return window;
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
    const window = await createMainWindow();
    const recorder = new RecorderWindowController();
    await recorder.initialize();

    if (isSmokeTest) {
      const [result, recorderReady] = await Promise.all([
        window.webContents.executeJavaScript(
          'window.untypo.ping()',
        ) as Promise<PingResponse>,
        recorder.smokeTest(),
      ]);
      if (!recorderReady)
        throw new Error('Recorder preload bridge is unavailable');
      console.log(
        `SMOKE_OK ${result.appName} ${result.version} ${result.platform} recorder`,
      );
      recorder.destroy();
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
