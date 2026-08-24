const normalizedMimeType = (mimeType: string): string =>
  mimeType.split(';', 1)[0]?.trim().toLowerCase() || 'audio/webm';

export const audioMediaType = (mimeType: string): string =>
  normalizedMimeType(mimeType);

export const audioFormatFromMimeType = (mimeType: string): string => {
  const normalized = normalizedMimeType(mimeType);
  // Check the container before codecs; audio/webm;codecs=opus is WebM.
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('amr')) return 'amr';
  return 'webm';
};

export const audioFileExtension = (mimeType: string): string =>
  audioFormatFromMimeType(mimeType);
