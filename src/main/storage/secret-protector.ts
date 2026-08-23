export interface EncryptedValue {
  ciphertext: string;
  scheme: string;
}

export interface SecretProtector {
  protect: (plaintext: string) => EncryptedValue;
  reveal: (encrypted: EncryptedValue) => string;
}

export class MemorySecretProtector implements SecretProtector {
  protect(plaintext: string): EncryptedValue {
    return {
      ciphertext: Buffer.from(`test:${plaintext}`, 'utf8').toString('base64'),
      scheme: 'memory-test-v1',
    };
  }

  reveal(encrypted: EncryptedValue): string {
    const decoded = Buffer.from(encrypted.ciphertext, 'base64').toString(
      'utf8',
    );
    if (encrypted.scheme !== 'memory-test-v1' || !decoded.startsWith('test:')) {
      throw new Error('Unsupported encrypted value');
    }
    return decoded.slice(5);
  }
}
