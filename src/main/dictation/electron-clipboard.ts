import { clipboard, ClipboardItem } from 'electron';
import type { ClipboardPort } from './clipboard.js';

export type ElectronClipboardSnapshot = Electron.ClipboardItem[];

export class ElectronClipboardAdapter implements ClipboardPort<ElectronClipboardSnapshot> {
  async readSnapshot(): Promise<ElectronClipboardSnapshot> {
    const items = await clipboard.read();
    return Promise.all(
      items.map(async (item) => {
        const entries = await Promise.all(
          item.types.map(async (type) => {
            const value =
              type === 'electron application/bookmark'
                ? await item.getType('electron application/bookmark')
                : await item.getType(type);
            return [type, value] as const;
          }),
        );
        // Read items are lazy and cannot be written back after the clipboard changes.
        return new ClipboardItem(Object.fromEntries(entries));
      }),
    );
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
