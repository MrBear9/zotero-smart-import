/**
 * 重复判定核心算法
 *
 * 与 UI / 数据库解耦，纯函数，便于单元测试。
 */

/** 归一化标题：去变音符号、转小写、只留字母数字 */
export function normTitle(v) {
  if (!v) return '';
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 归一化 DOI */
export function normDOI(v) {
  if (!v) return '';
  return String(v)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/\s+/g, '');
}

/** 归一化 ISBN */
export function normISBN(v) {
  if (!v) return '';
  return String(v).replace(/[^0-9xX]/g, '').toUpperCase();
}

/** 生成 bigram 集合 */
export function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Dice 系数 */
export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** 从日期字段提取年份 */
export function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/** 提取作者姓氏列表 */
export function surnames(creators) {
  if (!Array.isArray(creators)) return [];
  return creators
    .filter((c) => c && c.creatorType === 'author')
    .map((c) => (c.lastName || c.name || '').toLowerCase())
    .filter(Boolean);
}

/**
 * 两条文献是否重复。
 *
 * 返回 { reason, score } 或 null。
 * 优先级：DOI > ISBN > 标题+作者+年份模糊
 */
export function matchPair(a, b, opts = {}) {
  const threshold = opts.fuzzyThreshold ?? 0.85;
  const yearTolerance = opts.yearTolerance ?? 1;

  // 1. DOI
  const doiA = normDOI(a.DOI);
  const doiB = normDOI(b.DOI);
  if (doiA && doiB && doiA === doiB) {
    return { reason: `DOI 相同（${a.DOI}）`, score: 1 };
  }

  // 2. ISBN
  const isbnA = normISBN(a.ISBN);
  const isbnB = normISBN(b.ISBN);
  if (isbnA && isbnB && isbnA === isbnB) {
    return { reason: `ISBN 相同（${a.ISBN}）`, score: 1 };
  }

  // 3. 标题模糊
  const tA = normTitle(a.title);
  const tB = normTitle(b.title);
  if (tA.length < 5 || tB.length < 5) return null;

  const sim = dice(bigrams(tA), bigrams(tB));
  if (sim < threshold) return null;

  const yA = extractYear(a.date);
  const yB = extractYear(b.date);
  if (yA && yB && Math.abs(yA - yB) > yearTolerance) return null;

  const sA = surnames(a.creators);
  const sB = surnames(b.creators);
  if (sA.length && sB.length && !sA.some((x) => sB.includes(x))) return null;

  return {
    reason: `标题相似 ${(sim * 100).toFixed(0)}%` + (yA ? `，${yA}` : ''),
    score: sim,
  };
}

/**
 * 在条目数组中找出所有重复组。
 *
 * @param {Array<object>} items - 每项形如 { id, title, DOI, ISBN, date, creators }
 * @param {object} opts
 * @returns {Array<{ key, items, reason }>}
 */
export function findDuplicateGroups(items, opts = {}) {
  const groups = [];
  const covered = new Set();
  const valid = items.filter((x) => x && x.id != null);
  if (valid.length < 2) return groups;

  // A. DOI 分组
  const byDOI = new Map();
  for (const it of valid) {
    const k = normDOI(it.DOI);
    if (!k) continue;
    if (!byDOI.has(k)) byDOI.set(k, []);
    byDOI.get(k).push(it);
  }
  for (const [k, list] of byDOI) {
    if (list.length < 2) continue;
    groups.push({ key: `doi-${k}`, items: list, reason: `DOI 相同（${list[0].DOI}）` });
    list.forEach((x) => covered.add(x.id));
  }

  // B. ISBN 分组
  const byISBN = new Map();
  for (const it of valid) {
    if (covered.has(it.id)) continue;
    const k = normISBN(it.ISBN);
    if (!k) continue;
    if (!byISBN.has(k)) byISBN.set(k, []);
    byISBN.get(k).push(it);
  }
  for (const [k, list] of byISBN) {
    if (list.length < 2) continue;
    groups.push({ key: `isbn-${k}`, items: list, reason: `ISBN 相同（${list[0].ISBN}）` });
    list.forEach((x) => covered.add(x.id));
  }

  // C. 标题模糊：先按前 3 字符分桶，桶内两两比
  const buckets = new Map();
  for (const it of valid) {
    if (covered.has(it.id)) continue;
    const norm = normTitle(it.title);
    if (norm.length < 5) continue;
    const k = norm.slice(0, 3);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push({ item: it, norm });
  }

  const used = new Set();
  const threshold = opts.fuzzyThreshold ?? 0.85;
  const yearTolerance = opts.yearTolerance ?? 1;

  for (const [, list] of buckets) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (used.has(a.item.id) || used.has(b.item.id)) continue;

        const sim = dice(bigrams(a.norm), bigrams(b.norm));
        if (sim < threshold) continue;

        const yA = extractYear(a.item.date);
        const yB = extractYear(b.item.date);
        if (yA && yB && Math.abs(yA - yB) > yearTolerance) continue;

        const sA = surnames(a.item.creators);
        const sB = surnames(b.item.creators);
        if (sA.length && sB.length && !sA.some((x) => sB.includes(x))) continue;

        groups.push({
          key: `fuzzy-${a.item.id}-${b.item.id}`,
          items: [a.item, b.item],
          reason: `标题相似 ${(sim * 100).toFixed(0)}%` + (yA ? `，${yA}` : ''),
        });
        used.add(a.item.id);
        used.add(b.item.id);
      }
    }
  }

  return groups;
}

/**
 * 去掉 Zotero 导入时自动追加的时间戳后缀。
 *
 * Zotero 遇到同名分类会改成「光计算 2026/11/8 18:30:00」，
 * 这里把后缀剥掉以便匹配原分类。
 *
 * @returns {string} 剥离后的名字；无时间戳后缀则返回空字符串
 */
export function stripTimestampSuffix(name) {
  if (!name) return '';
  const patterns = [
    /\s+\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s*$/,
    /\s+\d{4}[/-]\d{1,2}[/-]\d{1,2},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*$/i,
    /\s+\d{1,2}[/-]\d{1,2}[/-]\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*$/i,
  ];
  for (const re of patterns) {
    if (re.test(name)) return name.replace(re, '').trim();
  }
  return '';
}
