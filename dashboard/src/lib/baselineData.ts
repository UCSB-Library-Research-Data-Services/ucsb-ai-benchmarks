import * as fs from 'fs';
import * as path from 'path';
import type { BaselinesFile } from './baseline';

export function loadBaselines(): BaselinesFile | null {
  try {
    const p = path.join(process.cwd(), '..', 'data', 'baselines.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselinesFile;
  } catch {
    return null;
  }
}
