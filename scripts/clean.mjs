#!/usr/bin/env node
/** 清理构建产物 */

import { rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

for (const dir of ['build', 'dist']) {
  const target = join(ROOT, dir);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`已删除 ${dir}/`);
  }
}

console.log('清理完成');
