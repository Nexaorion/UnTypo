import type { UntypoApi } from '../shared/client-ipc';

declare global {
  interface Window {
    untypo?: UntypoApi;
  }
}

export {};
