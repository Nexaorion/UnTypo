import { clipboard, nativeImage } from 'electron';
import type { ClipboardPort } from './clipboard.js';

export interface ElectronClipboardSnapshot {
  bookmark?: string;
  html?: string;
  imagePng?: Buffer;
  rtf?: string;
  text?: string;
}

export class ElectronClipboardAdapter implements ClipboardPort<ElectronClipboardSnapshot> {
  readSnapshot(): ElectronClipboardSnapshot {
    const image = clipboard.readImage();
    const bookmark = clipboard.readBookmark();
    const text = clipboard.readText();
    const html = clipboard.readHTML();
    const rtf = clipboard.readRTF();
    return {
      ...(bookmark.url ? { bookmark: bookmark.url } : {}),
      ...(html ? { html } : {}),
      ...(!image.isEmpty() ? { imagePng: image.toPNG() } : {}),
      ...(rtf ? { rtf } : {}),
      ...(text ? { text } : {}),
    };
  }

  writeText(text: string): void {
    clipboard.writeText(text);
  }

  isCurrentText(text: string): boolean {
    return clipboard.readText() === text;
  }

  restore(snapshot: ElectronClipboardSnapshot): void {
    if (Object.keys(snapshot).length === 0) {
      clipboard.clear();
      return;
    }
    clipboard.write({
      ...(snapshot.text ? { text: snapshot.text } : {}),
      ...(snapshot.html ? { html: snapshot.html } : {}),
      ...(snapshot.rtf ? { rtf: snapshot.rtf } : {}),
      ...(snapshot.bookmark ? { bookmark: snapshot.bookmark } : {}),
      ...(snapshot.imagePng
        ? { image: nativeImage.createFromBuffer(snapshot.imagePng) }
        : {}),
    });
  }
}
