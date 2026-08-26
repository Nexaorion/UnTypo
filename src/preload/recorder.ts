import { contextBridge, ipcRenderer } from 'electron';
import type {
  RecorderApi,
  RecorderDeviceInfo,
  RecorderStartMetadata,
  RecorderStopMetadata,
} from '../shared/recorder-ipc.js';

const channels = {
  chunk: 'recorder:chunk',
  commandStart: 'recorder:command-start',
  commandStop: 'recorder:command-stop',
  commandListDevices: 'recorder:command-list-devices',
  devices: 'recorder:devices',
  error: 'recorder:error',
  level: 'recorder:level',
  started: 'recorder:started',
  stopped: 'recorder:stopped',
} as const;

const api: RecorderApi = {
  onListDevices: (listener) => {
    ipcRenderer.on(channels.commandListDevices, (_event, requestId: string) =>
      listener(requestId),
    );
  },
  onStart: (listener) => {
    ipcRenderer.on(
      channels.commandStart,
      (
        _event,
        sessionId: string,
        microphoneDeviceId?: string,
        outputFormat?: 'wav' | 'webm',
      ) => listener(sessionId, microphoneDeviceId, outputFormat),
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
  sendDevices: (
    requestId: string,
    devices: readonly RecorderDeviceInfo[],
    error?: string,
  ) => {
    ipcRenderer.send(channels.devices, requestId, devices, error);
  },
  sendLevel: (sessionId: string, level: number) => {
    ipcRenderer.send(channels.level, sessionId, level);
  },
  sendStarted: (sessionId: string, metadata: RecorderStartMetadata) => {
    ipcRenderer.send(channels.started, sessionId, metadata);
  },
  sendStopped: (sessionId: string, metadata: RecorderStopMetadata) => {
    ipcRenderer.send(channels.stopped, sessionId, metadata);
  },
};

contextBridge.exposeInMainWorld('recorder', api);
