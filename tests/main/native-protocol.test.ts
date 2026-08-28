import { describe, expect, it } from 'vitest';
import {
  NATIVE_FRAME_HEADER_BYTES,
  NATIVE_PROTOCOL_MAGIC,
  NativeFrameDecoder,
  NativeMessageType,
  decodeHotkeyConfigurationResult,
  decodeTargetSnapshot,
  encodeHotkeyConfiguration,
  encodeNativeFrame,
  encodePasteRequest,
} from '../../src/main/native/protocol';

const targetContextField = (value: string): Buffer => {
  const content = Buffer.from(value, 'utf16le');
  const field = Buffer.alloc(2 + content.byteLength);
  field.writeUInt16LE(value.length, 0);
  content.copy(field, 2);
  return field;
};

describe('native helper protocol v3', () => {
  it('encodes the packed C++ frame header', () => {
    const frame = encodeNativeFrame(
      NativeMessageType.Ping,
      new Uint8Array([1, 2]),
    );

    expect(frame.byteLength).toBe(NATIVE_FRAME_HEADER_BYTES + 2);
    expect(frame.readUInt32LE(0)).toBe(NATIVE_PROTOCOL_MAGIC);
    expect(frame.readUInt16LE(4)).toBe(3);
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
    const fixedTarget = Buffer.alloc(14);
    fixedTarget.writeBigUInt64LE(0x1234n, 0);
    fixedTarget.writeUInt32LE(42, 8);
    fixedTarget.writeUInt8(1, 12);
    fixedTarget.writeUInt8(0, 13);
    const targetPayload = Buffer.concat([
      fixedTarget,
      targetContextField('Codex'),
      targetContextField('ChatGPT.exe'),
    ]);

    const target = decodeTargetSnapshot(targetPayload);
    expect(target).toEqual({
      editable: true,
      higherIntegrity: false,
      processName: 'ChatGPT.exe',
      processId: 42,
      windowHandle: '4660',
      windowTitle: 'Codex',
    });
    expect(encodePasteRequest(target)).toEqual(fixedTarget.subarray(0, 12));
  });

  it('rejects malformed target context fields', () => {
    const payload = Buffer.concat([
      Buffer.alloc(14),
      Buffer.from([2, 0, 65, 0]),
    ]);

    expect(() => decodeTargetSnapshot(payload)).toThrow('invalid size');
  });

  it('matches the packed hotkey configuration layout', () => {
    const payload = encodeHotkeyConfiguration({
      modifiers: 6,
      virtualKey: 0x20,
    });

    expect(payload.byteLength).toBe(8);
    expect(payload.readUInt32LE(0)).toBe(0x20);
    expect(payload.readUInt32LE(4)).toBe(6);
  });

  it('decodes the Windows registration result', () => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(1409, 0);
    expect(decodeHotkeyConfigurationResult(payload)).toBe(1409);
  });
});
