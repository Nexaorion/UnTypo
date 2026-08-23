import { safeStorage } from 'electron';
import type { EncryptedValue, SecretProtector } from './secret-protector.js';

export class ElectronSecretProtector implements SecretProtector {
  protect(plaintext: string): EncryptedValue {
    this.assertAvailable();
    return {
      ciphertext: safeStorage.encryptString(plaintext).toString('base64'),
      scheme: 'electron-safe-storage-v1',
    };
  }

  reveal(encrypted: EncryptedValue): string {
    this.assertAvailable();
    if (encrypted.scheme !== 'electron-safe-storage-v1') {
      throw new Error('Unsupported encrypted value');
    }
    return safeStorage.decryptString(
      Buffer.from(encrypted.ciphertext, 'base64'),
    );
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating system encryption is unavailable');
    }
  }
}
