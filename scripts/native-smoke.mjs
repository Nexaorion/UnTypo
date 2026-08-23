import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { NativeHelperClient } = require('../dist/main/native/client.js');

const executablePath = path.resolve('build/Release/untypo_native_helper.exe');
const client = new NativeHelperClient(executablePath);

await client.start();
try {
  client.configureHotkey({ mode: 'toggle', modifiers: 0, virtualKey: 0x87 });
  await client.ping();
  const target = await client.captureTarget();
  if (!target.windowHandle || target.processId < 0) {
    throw new Error('Native helper returned an invalid target');
  }
  process.stdout.write('NATIVE_SMOKE_OK\n');
} finally {
  await client.stop();
}
