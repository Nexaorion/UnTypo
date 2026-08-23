import type { CapsuleApi } from '../shared/capsule-ipc';

declare global {
  interface Window {
    capsule: CapsuleApi;
  }
}

export {};
