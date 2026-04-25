/**
 * 将 dist/ 打 zip 到 release/，供静态站上传
 */
import archiver from 'archiver';
import { createWriteStream, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('缺少 dist/，请先执行 npm run build:web');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { version, productName = 'teaching-workbench' } = pkg;
const baseName = String(productName)
  .replace(/[\s/\\:*?"<>|]+/g, '-')
  .replace(/-+/g, '-');
const outFile = join(root, 'release', `${baseName}-web-v${version}.zip`);

if (!existsSync(join(root, 'release'))) {
  mkdirSync(join(root, 'release'), { recursive: true });
}

const output = createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on('close', () => resolve(undefined));
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(dist, false);
  archive.finalize();
});

console.log('已生成:', outFile);
