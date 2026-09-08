import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { SelectionAPI, SelectionState } from '../shared/selection-ipc.js';

const channels = {
  state: 'selection:state',
  changed: 'selection:changed',
  retry: 'selection:retry',
  cancel: 'selection:cancel',
  copy: 'selection:copy',
  replace: 'selection:replace',
  close: 'selection:close',
} as const;
const api: SelectionAPI = {
  getState: () => ipcRenderer.invoke(channels.state) as Promise<SelectionState>,
  onChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: SelectionState) =>
      listener(state);
    ipcRenderer.on(channels.changed, handler);
    return () => {
      ipcRenderer.off(channels.changed, handler);
    };
  },
  retry: (sessionId) =>
    ipcRenderer.invoke(channels.retry, {
      sessionId,
    }) as Promise<void>,
  cancel: (sessionId) =>
    ipcRenderer.invoke(channels.cancel, { sessionId }) as Promise<void>,
  copy: (sessionId) =>
    ipcRenderer.invoke(channels.copy, { sessionId }) as Promise<void>,
  replace: (sessionId) =>
    ipcRenderer.invoke(channels.replace, { sessionId }) as Promise<void>,
  close: (sessionId) =>
    ipcRenderer.invoke(channels.close, { sessionId }) as Promise<void>,
};
contextBridge.exposeInMainWorld('selection', api);
