import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const assetDirectories = ['assets', 'fonts'].map((name) => join(distDirectory, name)).filter(existsSync);
const assets = assetDirectories.flatMap((directory) => readdirSync(directory)
  .filter((file) => /\.(js|css|woff2)$/.test(file))
  .map((file) => join(directory, file)));
for (const path of assets) {
  const content = readFileSync(path);
  writeFileSync(`${path}.gz`, gzipSync(content, { level: 9 }));
  writeFileSync(`${path}.br`, brotliCompressSync(content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }));
}
console.log(`Created gzip and Brotli copies for ${assets.length} app/font assets.`);
