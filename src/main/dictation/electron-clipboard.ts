import { clipboard, ClipboardItem } from 'electron';
import type { ClipboardPort } from './clipboard.js';

export type ElectronClipboardSnapshot = Electron.ClipboardItem[];

export class ElectronClipboardAdapter implements ClipboardPort<ElectronClipboardSnapshot> {
  async readSnapshot(): Promise<ElectronClipboardSnapshot> {
    const items = await clipboard.read();
    const restored: ElectronClipboardSnapshot = [];
    for (const item of items) {
      if (item.types.length === 0) continue;
      const entries = await Promise.all(
        item.types.map(async (type) => {
          const value =
            type === 'electron application/bookmark'
              ? await item.getType('electron application/bookmark')
              : await item.getType(type);
          return [type, value] as const;
        }),
      );
      const payload = Object.fromEntries(entries);
      if (Object.keys(payload).length === 0) continue;
      // Read items are lazy and cannot be written back after the clipboard changes.
      restored.push(new ClipboardItem(payload));
    }
    return restored;
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
