import { cpSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'data', 'details');
const dest = join(here, '..', 'public', 'data', 'details');

if (!existsSync(src)) {
  console.log(`copy-details: no ${src}, skipping`);
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-details: mirrored ${src} -> ${dest}`);
