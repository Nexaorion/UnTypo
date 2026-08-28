export const NATIVE_PROTOCOL_MAGIC = 0x50595455;
export const NATIVE_PROTOCOL_VERSION = 3;
export const NATIVE_MAXIMUM_PAYLOAD_BYTES = 1024 * 1024;
export const NATIVE_FRAME_HEADER_BYTES = 12;
const NATIVE_TARGET_FIXED_BYTES = 14;
const NATIVE_TARGET_CONTEXT_MAXIMUM_CHARACTERS = 512;

export enum NativeMessageType {
  Authenticate = 1,
  ConfigureHotkey = 2,
  CaptureTarget = 3,
  Paste = 4,
  Ping = 5,
  Shutdown = 6,
  HotkeyEvent = 100,
  Authenticated = 101,
  TargetCaptured = 102,
  PasteResult = 103,
  Pong = 104,
  HotkeyConfigured = 105,
  Error = 106,
}

export enum NativeHotkeyAction {
  Toggle = 3,
}

export enum NativePasteStatus {
  Success = 1,
  TargetChanged = 2,
  NotEditable = 3,
  HigherIntegrity = 4,
  SendInputFailed = 5,
}

export interface NativeFrame {
  payload: Buffer;
  type: NativeMessageType;
}

export interface NativeHotkeyConfiguration {
  modifiers: number;
  virtualKey: number;
}

export interface NativeTargetSnapshot {
  editable: boolean;
  higherIntegrity: boolean;
  processName?: string;
  processId: number;
  windowHandle: string;
  windowTitle?: string;
}

export const encodeNativeFrame = (
  type: NativeMessageType,
  payload: Uint8Array = new Uint8Array(),
): Buffer => {
  if (payload.byteLength > NATIVE_MAXIMUM_PAYLOAD_BYTES) {
    throw new Error('Native helper payload is too large');
  }
  const frame = Buffer.allocUnsafe(
    NATIVE_FRAME_HEADER_BYTES + payload.byteLength,
  );
  frame.writeUInt32LE(NATIVE_PROTOCOL_MAGIC, 0);
  frame.writeUInt16LE(NATIVE_PROTOCOL_VERSION, 4);
  frame.writeUInt16LE(type, 6);
  frame.writeUInt32LE(payload.byteLength, 8);
  Buffer.from(payload).copy(frame, NATIVE_FRAME_HEADER_BYTES);
  return frame;
};

export const encodeHotkeyConfiguration = (
  configuration: NativeHotkeyConfiguration,
): Buffer => {
  if (
    !Number.isInteger(configuration.virtualKey) ||
    configuration.virtualKey < 1 ||
    configuration.virtualKey > 0xff
  ) {
    throw new Error('Native hotkey virtual key is invalid');
  }
  const payload = Buffer.alloc(8);
  payload.writeUInt32LE(configuration.virtualKey, 0);
  payload.writeUInt32LE(configuration.modifiers, 4);
  return payload;
};

export const decodeHotkeyConfigurationResult = (payload: Buffer): number => {
  if (payload.byteLength !== 4) {
    throw new Error('Native hotkey response has an invalid size');
  }
  return payload.readUInt32LE(0);
};

export const decodeTargetSnapshot = (payload: Buffer): NativeTargetSnapshot => {
  if (payload.byteLength < NATIVE_TARGET_FIXED_BYTES + 4) {
    throw new Error('Native target snapshot has an invalid size');
  }
  let offset = NATIVE_TARGET_FIXED_BYTES;
  const readContext = (): string => {
    if (offset + 2 > payload.byteLength) {
      throw new Error('Native target snapshot has an invalid size');
    }
    const characters = payload.readUInt16LE(offset);
    offset += 2;
    if (characters > NATIVE_TARGET_CONTEXT_MAXIMUM_CHARACTERS) {
      throw new Error('Native target context is too large');
    }
    const bytes = characters * 2;
    if (offset + bytes > payload.byteLength) {
      throw new Error('Native target snapshot has an invalid size');
    }
    const value = payload.toString('utf16le', offset, offset + bytes);
    offset += bytes;
    return value;
  };
  const windowTitle = readContext();
  const processName = readContext();
  if (offset !== payload.byteLength) {
    throw new Error('Native target snapshot has an invalid size');
  }
  return {
    editable: payload.readUInt8(12) === 1,
    higherIntegrity: payload.readUInt8(13) === 1,
    ...(processName ? { processName } : {}),
    processId: payload.readUInt32LE(8),
    windowHandle: payload.readBigUInt64LE(0).toString(),
    ...(windowTitle ? { windowTitle } : {}),
  };
};

export const encodePasteRequest = (target: NativeTargetSnapshot): Buffer => {
  const payload = Buffer.alloc(12);
  payload.writeBigUInt64LE(BigInt(target.windowHandle), 0);
  payload.writeUInt32LE(target.processId, 8);
  return payload;
};

export class NativeFrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): readonly NativeFrame[] {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const frames: NativeFrame[] = [];

    while (this.#buffer.byteLength >= NATIVE_FRAME_HEADER_BYTES) {
      const magic = this.#buffer.readUInt32LE(0);
      const version = this.#buffer.readUInt16LE(4);
      const type = this.#buffer.readUInt16LE(6);
      const payloadBytes = this.#buffer.readUInt32LE(8);
      if (
        magic !== NATIVE_PROTOCOL_MAGIC ||
        version !== NATIVE_PROTOCOL_VERSION
      ) {
        throw new Error('Native helper protocol header is invalid');
      }
      if (payloadBytes > NATIVE_MAXIMUM_PAYLOAD_BYTES) {
        throw new Error('Native helper payload is too large');
      }
      const frameBytes = NATIVE_FRAME_HEADER_BYTES + payloadBytes;
      if (this.#buffer.byteLength < frameBytes) break;
      frames.push({
        payload: this.#buffer.subarray(NATIVE_FRAME_HEADER_BYTES, frameBytes),
        type,
      });
      this.#buffer = this.#buffer.subarray(frameBytes);
    }

    return frames;
  }
}
