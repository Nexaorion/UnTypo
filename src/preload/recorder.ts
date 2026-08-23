import { contextBridge, ipcRenderer } from 'electron';
import type {
  RecorderApi,
  RecorderStartMetadata,
  RecorderStopMetadata,
} from '../shared/recorder-ipc.js';

const channels = {
  chunk: 'recorder:chunk',
  commandStart: 'recorder:command-start',
  commandStop: 'recorder:command-stop',
  error: 'recorder:error',
  started: 'recorder:started',
  stopped: 'recorder:stopped',
} as const;

const api: RecorderApi = {
  onStart: (listener) => {
    ipcRenderer.on(channels.commandStart, (_event, sessionId: string) =>
      listener(sessionId),
    );
  },
  onStop: (listener) => {
    ipcRenderer.on(channels.commandStop, (_event, sessionId: string) =>
      listener(sessionId),
    );
  },
  sendChunk: (sessionId: string, chunk: ArrayBuffer) => {
    ipcRenderer.send(channels.chunk, sessionId, chunk);
  },
  sendError: (sessionId: string, message: string) => {
    ipcRenderer.send(channels.error, sessionId, message);
  },
  sendStarted: (sessionId: string, metadata: RecorderStartMetadata) => {
    ipcRenderer.send(channels.started, sessionId, metadata);
  },
  sendStopped: (sessionId: string, metadata: RecorderStopMetadata) => {
    ipcRenderer.send(channels.stopped, sessionId, metadata);
  },
};

contextBridge.exposeInMainWorld('recorder', api);
