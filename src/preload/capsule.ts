import { contextBridge, ipcRenderer } from 'electron';
import type { CapsuleApi, CapsuleResult } from '../shared/capsule-ipc.js';

const channels = {
  close: 'capsule:close',
  copy: 'capsule:copy',
  result: 'capsule:result',
  setInteractive: 'capsule:set-interactive',
} as const;

const api: CapsuleApi = {
  close: () => ipcRenderer.send(channels.close),
  copy: () => ipcRenderer.send(channels.copy),
  onResult: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      result: CapsuleResult,
    ) => listener(result);
    ipcRenderer.on(channels.result, wrapped);
    return () => ipcRenderer.removeListener(channels.result, wrapped);
  },
  setInteractive: (interactive) =>
    ipcRenderer.send(channels.setInteractive, interactive),
};

contextBridge.exposeInMainWorld('capsule', api);
