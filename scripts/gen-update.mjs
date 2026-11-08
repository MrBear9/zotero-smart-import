#!/usr/bin/env node
/**
 * 生成 update.json
 *
 * Zotero 通过 manifest 里的 update_url 检查更新，该文件必须是这个格式。
 *
 * 关键点：update_link 指向固定的 tag "release"。
 * 因为 workflow 每次发布都会把 "release" tag 移到最新提交、
 * 并整体更新同一个 Release，所以这个 URL 恒定有效。
 *
 * @see https://www.zotero.org/support/dev/zotero_7_for_developers#updater
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const mf = JSON.parse(readFileSync(join(ROOT, 'addon', 'manifest.json'), 'utf8'));

const version = pkg.version;
const addonID = mf.applications.zotero.id;
const strictMin = mf.applications.zotero.strict_min_version;
const strictMax = mf.applications.zotero.strict_max_version;

const repo = process.env.GITHUB_REPOSITORY || 'MrBear9/zotero-smart-import';
const tag = 'release';

// 找到构建产物
const xpiName = `smartimport-${version}.xpi`;
const xpiPath = join(DIST, xpiName);

if (!existsSync(xpiPath)) {
  console.error(`找不到构建产物: ${xpiPath}`);
  console.error('dist/ 下现有文件:', readdirSync(DIST).join(', ') || '(空)');
  process.exit(1);
}

const buf = readFileSync(xpiPath);
const sha256 = createHash('sha256').update(buf).digest('hex');

const updateLink = `https://github.com/${repo}/releases/download/${tag}/${xpiName}`;

const payload = {
  addons: {
    [addonID]: {
      updates: [
        {
          version,
          update_link: updateLink,
          update_hash: `sha256:${sha256}`,
          applications: {
            zotero: {
              strict_min_version: strictMin,
              strict_max_version: strictMax,
            },
          },
        },
      ],
    },
  },
};

const outPath = join(DIST, 'update.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

console.log('=== update.json ===');
console.log(JSON.stringify(payload, null, 2));
console.log('');
console.log(`已写入: ${outPath}`);
console.log(`xpi 大小: ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`sha256: ${sha256}`);
