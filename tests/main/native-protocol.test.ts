import { describe, expect, it } from 'vitest';
import {
  NATIVE_FRAME_HEADER_BYTES,
  NATIVE_PROTOCOL_MAGIC,
  NativeFrameDecoder,
  NativeMessageType,
  decodeTargetSnapshot,
  encodeHotkeyConfiguration,
  encodeNativeFrame,
  encodePasteRequest,
} from '../../src/main/native/protocol';

describe('native helper protocol v1', () => {
  it('encodes the packed C++ frame header', () => {
    const frame = encodeNativeFrame(
      NativeMessageType.Ping,
      new Uint8Array([1, 2]),
    );

    expect(frame.byteLength).toBe(NATIVE_FRAME_HEADER_BYTES + 2);
    expect(frame.readUInt32LE(0)).toBe(NATIVE_PROTOCOL_MAGIC);
    expect(frame.readUInt16LE(4)).toBe(1);
    expect(frame.readUInt16LE(6)).toBe(NativeMessageType.Ping);
    expect(frame.readUInt32LE(8)).toBe(2);
  });

  it('decodes fragmented and coalesced pipe frames', () => {
    const first = encodeNativeFrame(NativeMessageType.Pong);
    const second = encodeNativeFrame(
      NativeMessageType.HotkeyEvent,
      new Uint8Array([3]),
    );
    const combined = Buffer.concat([first, second]);
    const decoder = new NativeFrameDecoder();

    expect(decoder.push(combined.subarray(0, 7))).toEqual([]);
    expect(decoder.push(combined.subarray(7))).toEqual([
      { payload: Buffer.alloc(0), type: NativeMessageType.Pong },
      {
        payload: Buffer.from([3]),
        type: NativeMessageType.HotkeyEvent,
      },
    ]);
  });

  it('matches packed target and paste payload layouts', () => {
    const targetPayload = Buffer.alloc(14);
    targetPayload.writeBigUInt64LE(0x1234n, 0);
    targetPayload.writeUInt32LE(42, 8);
    targetPayload.writeUInt8(1, 12);
    targetPayload.writeUInt8(0, 13);

    const target = decodeTargetSnapshot(targetPayload);
    expect(target).toEqual({
      editable: true,
      higherIntegrity: false,
      processId: 42,
      windowHandle: '4660',
    });
    expect(encodePasteRequest(target)).toEqual(targetPayload.subarray(0, 12));
  });

  it('matches the packed hotkey configuration layout', () => {
    const payload = encodeHotkeyConfiguration({
      mode: 'push-to-talk',
      modifiers: 6,
      virtualKey: 0x20,
    });

    expect(payload.byteLength).toBe(9);
    expect(payload.readUInt32LE(0)).toBe(0x20);
    expect(payload.readUInt32LE(4)).toBe(6);
    expect(payload.readUInt8(8)).toBe(1);
  });
});
