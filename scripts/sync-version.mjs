#!/usr/bin/env node
/**
 * 版本同步脚本
 *
 * 由 npm 的 version 生命周期钩子调用（npm version patch/minor/major 时自动跑），
 * 把 package.json 的版本号写进 addon/manifest.json。
 *
 * 这样源码里的 manifest 和 package.json 保持一致，
 * 避免「改了版本号但 manifest 忘了改」的尴尬。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const mfPath = join(ROOT, 'addon', 'manifest.json');
const mf = JSON.parse(readFileSync(mfPath, 'utf8'));

const oldVersion = mf.version;
mf.version = pkg.version;
writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');

console.log(`版本同步: ${oldVersion} → ${pkg.version}`);

// 检查 update_url 是否还指向占位符
const updateUrl = mf.applications?.zotero?.update_url || '';
if (updateUrl.includes('github.com/MrBear9')) {
  console.log(`update_url: ${updateUrl}`);
} else {
  console.warn(`警告: update_url 可能不正确 → ${updateUrl}`);
}
