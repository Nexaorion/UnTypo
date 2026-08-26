import { deflateRawSync } from 'node:zlib';

export interface DiagnosticArchiveEntry {
  data: Buffer | string;
  path: string;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let index = 0; index < 8; index += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const zipPath = (value: string): string => {
  const normalized = value.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
  if (
    !normalized ||
    normalized.split('/').some((segment) => segment === '..' || !segment)
  ) {
    throw new Error('Diagnostic archive entry path is invalid');
  }
  return normalized;
};

const dosTimestamp = (date: Date): { date: number; time: number } => ({
  date:
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate(),
  time:
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2),
});

export const createDiagnosticZip = (
  entries: readonly DiagnosticArchiveEntry[],
  createdAt = new Date(),
): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const timestamp = dosTimestamp(createdAt);

  for (const entry of entries) {
    const name = Buffer.from(zipPath(entry.path), 'utf8');
    const source = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(timestamp.time, 12);
    central.writeUInt16LE(timestamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
};
