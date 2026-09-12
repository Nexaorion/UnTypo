import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const header = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header, data])));
  return Buffer.concat([length, header, data, crc]);
};

const writePng = (width, height, pixels) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const paintBar = (pixels, width, x, y, w, h) => {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const offset = (row * width + column) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }
};

const render = (size) => {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 16;
  const bars = [
    { x: 1, y: 6, w: 2, h: 5 },
    { x: 4, y: 4, w: 2, h: 9 },
    { x: 7, y: 2, w: 2, h: 12 },
    { x: 10, y: 4, w: 2, h: 9 },
    { x: 13, y: 6, w: 2, h: 5 },
  ];
  for (const bar of bars) {
    paintBar(
      pixels,
      size,
      Math.round(bar.x * scale),
      Math.round(bar.y * scale),
      Math.max(1, Math.round(bar.w * scale)),
      Math.round(bar.h * scale),
    );
  }
  return writePng(size, size, pixels);
};

await writeFile('assets/untypo-trayTemplate.png', render(16));
await writeFile('assets/untypo-trayTemplate@2x.png', render(32));
