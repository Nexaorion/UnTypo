import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const fileName = `UnTypo-${version}.AppImage`;
const filePath = path.join(releaseDir, fileName);
const [appImage, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
const sha512 = createHash('sha512').update(appImage).digest('base64');
const releaseDate = new Date().toISOString();

const metadata = [
  `version: ${version}`,
  'files:',
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${fileStats.size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n');

await writeFile(path.join(releaseDir, 'latest-linux.yml'), metadata);
console.log(`Wrote update metadata for ${fileName}`);
