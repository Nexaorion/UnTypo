import type { RecorderApi } from '../shared/recorder-ipc';

declare global {
  interface Window {
    recorder: RecorderApi;
  }
}

export {};
