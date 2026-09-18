import {
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  randomBytes,
} from 'node:crypto';
import { promisify } from 'node:util';
import { parseBackupCode } from './backup-code.js';

export const UNTYPO_FILE_MAGIC = Buffer.from('UNTYPO\x01\x00', 'latin1');
export const UNTYPO_FILE_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_KEY_LENGTH = 32;
export const PBKDF2_DIGEST = 'sha512';
export const AES_IV_LENGTH = 12;
export const AES_AUTH_TAG_LENGTH = 16;
export const SALT_LENGTH = 32;

const HEADER_LENGTH_BYTES = 4;
const MAXIMUM_HEADER_LENGTH = 16_384;
const MAXIMUM_FILE_LENGTH = 64 * 1024 * 1024;

export type UntypoFileContentType = 'full-backup' | 'incremental';

export interface UntypoFileHeader {
  appVersion: string;
  authTag: string;
  contentType: UntypoFileContentType;
  createdAt: number;
  iv: string;
  salt: string;
  version: typeof UNTYPO_FILE_VERSION;
}

export interface UntypoSyncPayload {
  deviceName: string;
  dictionary: unknown;
  dictionaryLearningState?: unknown;
  exportedAt: number;
  history: unknown;
  personalization: unknown;
  profile?: unknown;
  version: typeof UNTYPO_FILE_VERSION;
}

export class UntypoFileError extends Error {
  readonly code:
    | 'CORRUPT'
    | 'INVALID_HEADER'
    | 'INVALID_MAGIC'
    | 'INVALID_PASSWORD'
    | 'TOO_LARGE';

  constructor(
    code:
      | 'CORRUPT'
      | 'INVALID_HEADER'
      | 'INVALID_MAGIC'
      | 'INVALID_PASSWORD'
      | 'TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'UntypoFileError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const encodeLengthPrefixed = (value: Buffer): Buffer => {
  const prefix = Buffer.alloc(HEADER_LENGTH_BYTES);
  prefix.writeUInt32LE(value.length, 0);
  return Buffer.concat([prefix, value]);
};

const pbkdf2Async = promisify(pbkdf2);

const deriveKey = async (backupCode: string, salt: Buffer): Promise<Buffer> =>
  pbkdf2Async(
    backupCode,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST,
  );

const decodeBase64Exact = (value: string, expectedLength: number): Buffer => {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedLength) {
    throw new UntypoFileError('INVALID_HEADER', 'File header is invalid');
  }
  return decoded;
};

const parseHeader = (value: unknown): UntypoFileHeader => {
  if (!isRecord(value)) {
    throw new UntypoFileError('INVALID_HEADER', 'File header is invalid');
  }
  if (
    value.version !== UNTYPO_FILE_VERSION ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    typeof value.appVersion !== 'string' ||
    value.appVersion.length === 0 ||
    value.appVersion.length > 64 ||
    (value.contentType !== 'full-backup' &&
      value.contentType !== 'incremental') ||
    typeof value.salt !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.authTag !== 'string'
  ) {
    throw new UntypoFileError('INVALID_HEADER', 'File header is invalid');
  }
  decodeBase64Exact(value.salt, SALT_LENGTH);
  decodeBase64Exact(value.iv, AES_IV_LENGTH);
  decodeBase64Exact(value.authTag, AES_AUTH_TAG_LENGTH);
  return {
    appVersion: value.appVersion,
    authTag: value.authTag,
    contentType: value.contentType,
    createdAt: value.createdAt,
    iv: value.iv,
    salt: value.salt,
    version: UNTYPO_FILE_VERSION,
  };
};

const parsePayload = (value: unknown): UntypoSyncPayload => {
  if (!isRecord(value)) {
    throw new UntypoFileError('CORRUPT', 'Sync file is damaged');
  }
  if (
    value.version !== UNTYPO_FILE_VERSION ||
    typeof value.exportedAt !== 'number' ||
    !Number.isFinite(value.exportedAt) ||
    value.exportedAt < 0 ||
    typeof value.deviceName !== 'string' ||
    value.deviceName.trim().length === 0 ||
    value.deviceName.length > 128 ||
    !('dictionary' in value) ||
    !('personalization' in value) ||
    !('history' in value)
  ) {
    throw new UntypoFileError('CORRUPT', 'Sync file is damaged');
  }
  return {
    deviceName: value.deviceName,
    dictionary: value.dictionary,
    ...(value.dictionaryLearningState === undefined
      ? {}
      : { dictionaryLearningState: value.dictionaryLearningState }),
    exportedAt: value.exportedAt,
    history: value.history,
    personalization: value.personalization,
    ...(value.profile === undefined ? {} : { profile: value.profile }),
    version: UNTYPO_FILE_VERSION,
  };
};

const packEncryptedPayload = async (
  payload: unknown,
  backupCode: string,
  options: {
    appVersion: string;
    contentType: UntypoFileContentType;
    createdAt: number;
  },
): Promise<Buffer> => {
  const code = parseBackupCode(backupCode);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(AES_IV_LENGTH);
  const key = await deriveKey(code, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const header: UntypoFileHeader = {
    appVersion: options.appVersion,
    authTag: authTag.toString('base64'),
    contentType: options.contentType,
    createdAt: options.createdAt,
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    version: UNTYPO_FILE_VERSION,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8');
  return Buffer.concat([
    UNTYPO_FILE_MAGIC,
    encodeLengthPrefixed(encodedHeader),
    encrypted,
  ]);
};

export const packSyncFile = (
  payload: UntypoSyncPayload,
  backupCode: string,
  options: {
    appVersion: string;
    contentType?: UntypoFileContentType;
    createdAt?: number;
  },
): Promise<Buffer> => {
  const createdAt = options.createdAt ?? Date.now();
  return packEncryptedPayload(payload, backupCode, {
    appVersion: options.appVersion,
    contentType: options.contentType ?? 'full-backup',
    createdAt,
  });
};

const unpackEncryptedPayload = async (
  buffer: Buffer,
  backupCode: string,
): Promise<{ header: UntypoFileHeader; payload: unknown }> => {
  if (buffer.length > MAXIMUM_FILE_LENGTH) {
    throw new UntypoFileError('TOO_LARGE', 'Sync file is too large');
  }
  if (
    buffer.length < UNTYPO_FILE_MAGIC.length + HEADER_LENGTH_BYTES ||
    !buffer.subarray(0, UNTYPO_FILE_MAGIC.length).equals(UNTYPO_FILE_MAGIC)
  ) {
    throw new UntypoFileError('INVALID_MAGIC', 'File is not an UnTypo backup');
  }
  const headerLength = buffer.readUInt32LE(UNTYPO_FILE_MAGIC.length);
  const headerStart = UNTYPO_FILE_MAGIC.length + HEADER_LENGTH_BYTES;
  const headerEnd = headerStart + headerLength;
  if (
    headerLength === 0 ||
    headerLength > MAXIMUM_HEADER_LENGTH ||
    headerEnd > buffer.length
  ) {
    throw new UntypoFileError('INVALID_HEADER', 'File header is invalid');
  }
  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(
      buffer.subarray(headerStart, headerEnd).toString('utf8'),
    );
  } catch {
    throw new UntypoFileError('INVALID_HEADER', 'File header is invalid');
  }
  const header = parseHeader(parsedHeader);
  const code = parseBackupCode(backupCode);
  const salt = decodeBase64Exact(header.salt, SALT_LENGTH);
  const iv = decodeBase64Exact(header.iv, AES_IV_LENGTH);
  const authTag = decodeBase64Exact(header.authTag, AES_AUTH_TAG_LENGTH);
  const key = await deriveKey(code, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([
      decipher.update(buffer.subarray(headerEnd)),
      decipher.final(),
    ]);
  } catch {
    throw new UntypoFileError(
      'INVALID_PASSWORD',
      'The password is incorrect or the file is damaged',
    );
  }
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new UntypoFileError('CORRUPT', 'Sync file is damaged');
  }
  return { header, payload: parsedPayload };
};

export const unpackSyncFile = async (
  buffer: Buffer,
  backupCode: string,
): Promise<UntypoSyncPayload> => {
  const { payload } = await unpackEncryptedPayload(buffer, backupCode);
  return parsePayload(payload);
};
