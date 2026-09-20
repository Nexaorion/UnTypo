import type { CapsuleApi } from '../shared/overlay-ipc';

declare global {
  interface Window {
    capsule: CapsuleApi;
  }
}

export {};
