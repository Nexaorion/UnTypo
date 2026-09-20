import type { IpcMainInvokeEvent } from 'electron';

const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:3000';

export const isTrustedRendererUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (process.env.VITE_DEV_SERVER_URL) {
      return url.origin === DEVELOPMENT_ORIGIN;
    }

    return url.protocol === 'app:' && url.host === 'renderer';
  } catch {
    return false;
  }
};

export const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || !isTrustedRendererUrl(senderUrl)) {
    throw new Error('Rejected IPC message from an untrusted renderer');
  }
};
