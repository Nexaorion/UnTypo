import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });

await run(npmCommand, ['run', 'build:main']);
await run(npmCommand, ['run', 'build:native']);

const vite = spawn(npmCommand, ['exec', 'vite'], { stdio: 'inherit' });
const children = [vite];

const stop = () => {
  for (const child of children) child.kill();
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('exit', stop);

for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:5173');
    if (response.ok) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const electron = spawn(electronPath, ['.'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  stdio: 'inherit',
});
children.push(electron);

electron.once('exit', (code) => {
  stop();
  process.exitCode = code ?? 1;
});
