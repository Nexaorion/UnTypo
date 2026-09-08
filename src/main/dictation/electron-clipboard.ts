import { clipboard } from 'electron';
import type { ClipboardPort } from './clipboard.js';

export type ElectronClipboardSnapshot = Electron.ClipboardItem[];

export class ElectronClipboardAdapter implements ClipboardPort<ElectronClipboardSnapshot> {
  readSnapshot(): Promise<ElectronClipboardSnapshot> {
    return clipboard.read();
  }

  writeText(text: string): Promise<void> {
    return clipboard.writeText(text);
  }

  async isCurrentText(text: string): Promise<boolean> {
    return (await clipboard.readText()) === text;
  }

  restore(snapshot: ElectronClipboardSnapshot): Promise<void> {
    if (snapshot.length === 0) {
      clipboard.clear();
      return Promise.resolve();
    }
    return clipboard.write(snapshot);
  }
}
