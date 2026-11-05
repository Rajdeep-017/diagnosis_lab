import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(join(distDirectory, 'index.html'), 'utf8');
const initialChunks = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1]);
if (!initialChunks.some((file) => file.includes('/index-'))) {
  console.error('Unable to find patient entry chunk in index.html.');
  process.exit(1);
}
const sizes = initialChunks.map((url) => {
  const file = join(distDirectory, url.replace(/^\//, ''));
  const content = readFileSync(file);
  return { file, raw: statSync(file).size, gzip: gzipSync(content, { level: 9 }).byteLength };
});
const rawBytes = sizes.reduce((total, item) => total + item.raw, 0);
const compressedBytes = sizes.reduce((total, item) => total + item.gzip, 0);
console.log(`Initial patient JS (${sizes.length} chunks): ${rawBytes} bytes raw, ${compressedBytes} bytes gzip.`);
if (compressedBytes > 120 * 1024) {
  console.error(`Patient entry exceeds the 120 KB gzip budget by ${compressedBytes - 120 * 1024} bytes.`);
  process.exit(1);
}
