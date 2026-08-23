import { rm } from 'node:fs/promises';

await Promise.all([
  rm('dist', { force: true, recursive: true }),
  rm('release', { force: true, recursive: true }),
]);
