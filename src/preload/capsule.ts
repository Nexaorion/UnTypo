import { contextBridge, ipcRenderer } from 'electron';
import type { CapsuleApi, CapsuleStatus } from '../shared/capsule-ipc.js';

const channels = {
  close: 'capsule:close',
  confirm: 'capsule:confirm',
  copy: 'capsule:copy',
  ready: 'capsule:ready',
  reject: 'capsule:reject',
  setInteractive: 'capsule:set-interactive',
  update: 'capsule:update',
} as const;

const api: CapsuleApi = {
  close: () => ipcRenderer.send(channels.close),
  confirm: () => ipcRenderer.send(channels.confirm),
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
  reject: () => ipcRenderer.send(channels.reject),
  setInteractive: (interactive) =>
    ipcRenderer.send(channels.setInteractive, interactive),
};

contextBridge.exposeInMainWorld('capsule', api);
