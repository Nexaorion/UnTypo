import { contextBridge, ipcRenderer } from 'electron';
import type { PingResponse, UntypoApi } from '../shared/ipc.js';

const PING_CHANNEL = 'app:ping';

const api: UntypoApi = {
  ping: () => ipcRenderer.invoke(PING_CHANNEL) as Promise<PingResponse>,
};

contextBridge.exposeInMainWorld('untypo', api);
