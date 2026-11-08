#!/usr/bin/env node
/**
 * 构建脚本
 *
 * Zotero bootstrap 插件的入口是 addon/bootstrap.js，但 Zotero 7+ 的
 * bootstrap 作用域不支持 ES module 的 import/export，所以构建时要把
 * src/ 下的模块打包成一个自包含的 IIFE。
 *
 * 用法：
 *   node scripts/build.mjs          构建 xpi
 *   node scripts/build.mjs --dev    构建但不压缩
 *   node scripts/build.mjs --watch  监听 src/ 变化自动重建
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');
const ADDON = join(ROOT, 'addon');
const BUILD = join(ROOT, 'build');
const DIST = join(ROOT, 'dist');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const cfg = pkg.config;

const args = new Set(process.argv.slice(2));
const WATCH = args.has('--watch');

// ---------------------------------------------------------------- 工具

function log(msg) {
  console.log(`  ${msg}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function rmrf(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 极简模块打包

/**
 * 把 ES module 源码转成 IIFE。
 *
 * 支持的语法（够本项目用）：
 *   import { a, b } from './x.js'
 *   import x from './x.js'
 *   export function f() {}
 *   export const x = ...
 *   export class C {}
 *   export { a, b }
 *   export default ...
 */

const moduleCache = new Map();

function resolveImportPath(fromFile, spec) {
  // 相对路径
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, join(base, 'index.js')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function collectModules(entry) {
  const ordered = [];
  const visiting = new Set();

  const visit = (file) => {
    if (moduleCache.has(file)) return;
    if (visiting.has(file)) {
      throw new Error(`循环依赖: ${relative(ROOT, file)}`);
    }
    visiting.add(file);

    let code = readFileSync(file, 'utf8');
    const depFiles = [];

    // 处理 import 语句
    code = code.replace(
      /^\s*import\s+(?:([\w*{][\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm,
      (match, bindings, spec) => {
        const dep = resolveImportPath(file, spec);
        if (!dep) {
          throw new Error(`无法解析 import "${spec}"，来自 ${relative(ROOT, file)}`);
        }
        depFiles.push(dep);
        // 生成一个占位注释，依赖声明在组装时统一处理
        return `/* __import__ ${JSON.stringify(spec)} | ${JSON.stringify(bindings || '')} */`;
      }
    );

    for (const dep of depFiles) visit(dep);

    const mod = { file, code, deps: depFiles };
    moduleCache.set(file, mod);
    ordered.push(mod);
    visiting.delete(file);
  };

  visit(entry);
  return ordered;
}

/** 把 export 声明改成普通声明，并记录导出 */
function stripExports(code) {
  const exportsMap = new Map(); // exportedName -> localName

  // export default function/class/const
  code = code.replace(
    /^export\s+default\s+(function\s*(\w*)|class\s*(\w*))/gm,
    (_match, decl, fnName, clsName) => {
      const name = fnName || clsName || 'defaultExport';
      exportsMap.set('default', name);
      return decl;
    }
  );
  code = code.replace(/^export\s+default\s+/gm, (_match) => {
    exportsMap.set('default', '__default_export__');
    return 'const __default_export__ = ';
  });

  // export function / class / const / let / var
  code = code.replace(
    /^export\s+(async\s+function|function|class|const|let|var)\s+(\w+)/gm,
    (m, kind, name) => {
      exportsMap.set(name, name);
      return `${kind} ${name}`;
    }
  );

  // export { a, b as c }
  code = code.replace(/^export\s*\{([^}]+)\};?/gm, (m, list) => {
    for (const part of list.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [local, exported] = t.split(/\s+as\s+/).map((s) => s.trim());
      exportsMap.set(exported || local, local);
    }
    return '';
  });

  return { code, exportsMap };
}

/** 从 import 绑定里解析出 name -> 来源模块 */
function parseImportBindings(bindings, sourceFile) {
  // 形如：{ a, b as c }  或  defaultName  或  defaultName, { a }
  const out = [];
  if (!bindings) return out;
  const b = bindings.trim();

  // 默认导入
  const defMatch = b.match(/^(\w+)\s*(?:,\s*(.*))?$/);
  if (defMatch && !b.startsWith('{')) {
    out.push({ imported: 'default', local: defMatch[1] });
    if (defMatch[2]) {
      out.push(...parseImportBindings(defMatch[2], sourceFile));
    }
    return out;
  }

  // 具名导入
  const named = b.match(/\{([^}]*)\}/);
  if (named) {
    for (const part of named[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [imported, local] = t.split(/\s+as\s+/).map((s) => s.trim());
      out.push({ imported, local: local || imported });
    }
  }
  return out;
}

function bundle(entryFile) {
  const modules = collectModules(entryFile);

  // 每个模块包在函数里：__mod_<n>
  const modIds = new Map();
  modules.forEach((m, i) => modIds.set(m.file, i));

  const parts = [];
  parts.push('// Generated by scripts/build.mjs — do not edit');
  parts.push('(function () {');
  parts.push('"use strict";');
  parts.push('');
  parts.push('const __modules = {};');
  parts.push('const __cache = {};');
  parts.push('');
  parts.push('function __require(id) {');
  parts.push('  if (__cache[id]) return __cache[id].exports;');
  parts.push('  const m = { exports: {} };');
  parts.push('  __cache[id] = m;');
  parts.push('  __modules[id](m, m.exports, __require);');
  parts.push('  return m.exports;');
  parts.push('}');
  parts.push('');

  // 每个模块
  modules.forEach((m, i) => {
    const { code, exportsMap } = stripExports(m.code);

    // 解析该模块的 import
    const importLines = [];
    const reImport = /\/\* __import__ ("(?:[^"\\]|\\.)*") \| ("(?:[^"\\]|\\.)*") \*\//g;
    let mm;
    while ((mm = reImport.exec(m.code))) {
      const spec = JSON.parse(mm[1]);
      const bindings = JSON.parse(mm[2]);
      const depFile = resolveImportPath(m.file, spec);
      const depId = modIds.get(depFile);
      for (const { imported, local } of parseImportBindings(bindings, m.file)) {
        importLines.push(
          `  const ${local} = __require(${depId}).${imported === 'default' ? 'default' : imported};`
        );
      }
    }

    parts.push(`// ---- module ${i}: ${relative(SRC, m.file)} ----`);
    parts.push(`__modules[${i}] = function (module, exports, __require) {`);
    for (const line of importLines) parts.push(line);
    parts.push(code);
    // 导出
    parts.push('  Object.assign(module.exports, {');
    for (const [exported, local] of exportsMap) {
      parts.push(`    ${JSON.stringify(exported)}: ${local},`);
    }
    parts.push('  });');
    parts.push('};');
    parts.push('');
  });

  // 入口：暴露 Zotero 生命周期函数到全局
  const entryId = modIds.get(entryFile);
  parts.push(`const __entry = __require(${entryId});`);
  parts.push('');
  parts.push('// Zotero bootstrap 需要这些全局函数');
  parts.push('this.install = __entry.install || function () {};');
  parts.push('this.uninstall = __entry.uninstall || function () {};');
  parts.push('this.startup = __entry.startup || function () {};');
  parts.push('this.shutdown = __entry.shutdown || function () {};');
  parts.push('');
  parts.push('}).call(this);');

  return parts.join('\n');
}

// ---------------------------------------------------------------- 主流程

function build() {
  console.log(`\n构建 ${cfg.addonName} v${pkg.version}\n`);

  // 1. 清理
  rmrf(BUILD);
  ensureDir(BUILD);

  // 2. 复制 addon/ 到 build/
  log('复制 addon 资源...');
  copyDir(ADDON, BUILD);

  // 3. 打包 src/
  log('打包源码...');
  const entry = join(SRC, 'index.js');
  const bundled = bundle(entry);
  writeFileSync(join(BUILD, 'bootstrap.js'), bundled, 'utf8');
  log(`bootstrap.js  ${(bundled.length / 1024).toFixed(1)} KB`);

  // 4. 写入版本号
  log('同步版本号...');
  const mfPath = join(BUILD, 'manifest.json');
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
  mf.version = pkg.version;
  writeFileSync(mfPath, JSON.stringify(mf, null, 2), 'utf8');

  // 5. 打 xpi
  ensureDir(DIST);
  const xpiName = `${cfg.addonRef}-${pkg.version}.xpi`;
  const xpiPath = join(DIST, xpiName);
  if (existsSync(xpiPath)) rmSync(xpiPath);

  log('打包 xpi...');
  try {
    // 优先用系统 zip（保留正斜杠路径）
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${BUILD}\\*' -DestinationPath '${xpiPath.replace(/\.xpi$/, '.zip')}' -Force"`,
      { stdio: 'pipe' }
    );
    const zipPath = xpiPath.replace(/\.xpi$/, '.zip');
    if (existsSync(zipPath)) {
      // 重命名为 xpi
      execSync(`powershell -NoProfile -Command "Move-Item '${zipPath}' '${xpiPath}' -Force"`, {
        stdio: 'pipe',
      });
    }
  } catch (e) {
    console.error('  打包失败:', e.message);
  }

  if (existsSync(xpiPath)) {
    const size = statSync(xpiPath).size;
    log(`✓ ${xpiName}  ${(size / 1024).toFixed(1)} KB`);
    const hash = createHash('sha256').update(readFileSync(xpiPath)).digest('hex');
    log(`  sha256: ${hash.slice(0, 16)}...`);
  }

  console.log('\n完成\n');
}

function copyDir(from, to) {
  ensureDir(to);
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    const st = statSync(src);
    if (st.isDirectory()) copyDir(src, dst);
    else {
      ensureDir(dirname(dst));
      writeFileSync(dst, readFileSync(src));
    }
  }
}

build();

if (WATCH) {
  console.log('监听 src/ 变化中（Ctrl+C 退出）...\n');
  let timer = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        moduleCache.clear();
        build();
      } catch (e) {
        console.error('构建失败:', e.message);
      }
    }, 300);
  };
  // Node 18 没有内置递归 watch 的稳定支持，用轮询兜底
  const { watch } = await import('node:fs');
  try {
    watch(SRC, { recursive: true }, onChange);
  } catch {
    console.log('（当前平台不支持递归监听，请手动重建）');
  }
}
