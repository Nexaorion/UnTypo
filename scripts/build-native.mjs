import { spawn } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'win32') {
  throw new Error('The native helper can only be built on Windows');
}

const programFilesX86 = process.env['ProgramFiles(x86)'];
if (!programFilesX86) throw new Error('Program Files (x86) is unavailable');

const vswhere = path.join(
  programFilesX86,
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
);

const capture = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });

const msbuildOutput = await capture(vswhere, [
  '-latest',
  '-products',
  '*',
  '-requires',
  'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
  '-find',
  'MSBuild\\**\\Bin\\MSBuild.exe',
]);
const msbuild = msbuildOutput.split(/\r?\n/u)[0];
if (!msbuild) throw new Error('MSBuild with the C++ workload was not found');

await run(msbuild, [
  'native/helper/UnTypo.NativeHelper.vcxproj',
  '/m',
  '/p:Configuration=Release',
  '/p:Platform=x64',
  '/verbosity:minimal',
]);
