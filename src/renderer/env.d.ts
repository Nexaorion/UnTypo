import type { UntypoApi } from '../shared/ipc';

declare global {
  interface Window {
    untypo?: UntypoApi;
  }
}

export {};
