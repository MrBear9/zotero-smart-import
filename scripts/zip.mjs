/**
 * 极简 ZIP 打包器
 *
 * 不用任何外部命令（Windows 的 Compress-Archive / Linux 的 zip），
 * 纯 Node 内置模块实现。目的是跨平台一致、路径分隔符可控。
 *
 * 只支持 STORE（不压缩）和 DEFLATE 两种方式，够插件用了。
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * 收集目录下所有文件
 * @returns {Array<{full: string, rel: string, size: number}>}
 */
function collectFiles(dir, baseDir = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, baseDir, out);
    } else if (st.isFile()) {
      // zip 规范要求正斜杠
      const rel = relative(baseDir, full).split('\\').join('/');
      out.push({ full, rel, size: st.size });
    }
  }
  return out;
}

/** 生成 DOS 时间戳 */
function dosDateTime(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

/**
 * 打包目录成 zip。
 *
 * @param {string} srcDir - 源目录（其内容会放在 zip 根部）
 * @param {string} outFile - 输出 zip 路径
 * @param {object} [opts]
 * @param {boolean} [opts.compress=true] - 是否用 DEFLATE
 * @param {number} [opts.level=9] - 压缩等级
 * @param {string[]} [opts.exclude] - 排除的相对路径前缀
 * @returns {number} 输出文件大小
 */
export function zipDirectory(srcDir, outFile, opts = {}) {
  const compress = opts.compress !== false;
  const level = opts.level ?? 9;
  const exclude = opts.exclude ?? [];

  const files = collectFiles(srcDir).filter(
    (f) => !exclude.some((ex) => f.rel === ex || f.rel.startsWith(ex + '/'))
  );

  if (!files.length) {
    throw new Error(`目录为空: ${srcDir}`);
  }

  const chunks = [];
  const centralDir = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime(new Date());

  for (const f of files) {
    const raw = readFileSync(f.full);
    const crc = crc32 ? crc32(raw) : crc32Fallback(raw);
    const method = compress ? 8 : 0;
    const data = compress ? deflateRawSync(raw, { level }) : raw;

    const nameBuf = Buffer.from(f.rel, 'utf8');

    // ---- Local file header ----
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: UTF-8
    local.writeUInt16LE(method, 8);       // compression
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(raw.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra length

    chunks.push(local, nameBuf, data);

    // ---- Central directory entry ----
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);     // flags: UTF-8
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset

    centralDir.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralDir);

  // ---- End of central directory ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const out = Buffer.concat([...chunks, centralBuf, eocd]);
  writeFileSync(outFile, out);
  return out.length;
}

/** crc32 兜底实现（Node < 20 没有 zlib.crc32） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Fallback(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
