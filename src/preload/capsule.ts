import { contextBridge, ipcRenderer } from 'electron';
import type { CapsuleApi, CapsuleStatus } from '../shared/capsule-ipc.js';

const channels = {
  close: 'capsule:close',
  copy: 'capsule:copy',
  ready: 'capsule:ready',
  setInteractive: 'capsule:set-interactive',
  update: 'capsule:update',
} as const;

const api: CapsuleApi = {
  close: () => ipcRenderer.send(channels.close),
  copy: () => ipcRenderer.send(channels.copy),
  onUpdate: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      status: CapsuleStatus,
    ) => listener(status);
    ipcRenderer.on(channels.update, wrapped);
    return () => ipcRenderer.removeListener(channels.update, wrapped);
  },
  ready: () => ipcRenderer.send(channels.ready),
  setInteractive: (interactive) =>
    ipcRenderer.send(channels.setInteractive, interactive),
};

contextBridge.exposeInMainWorld('capsule', api);
