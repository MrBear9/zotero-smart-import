/**
 * Zotero 数据适配层
 *
 * 把 Zotero.Item 转成 dedupe 模块需要的纯数据对象，
 * 并提供条目的读写操作。所有 Zotero API 调用集中在这里。
 */

/* global Zotero */

/** Zotero.Item → 纯数据 */
export function itemToPlain(item) {
  if (!item) return null;
  const creators = (() => {
    try {
      return item.getCreators() || [];
    } catch {
      return [];
    }
  })();

  const safeGet = (field) => {
    try {
      return item.getField(field) || '';
    } catch {
      return '';
    }
  };

  return {
    id: item.id,
    libraryID: item.libraryID,
    itemType: item.itemType,
    title: safeGet('title'),
    DOI: safeGet('DOI'),
    ISBN: safeGet('ISBN'),
    date: safeGet('date'),
    creators,
    publicationTitle: safeGet('publicationTitle') || safeGet('publisher'),
  };
}

/** 批量加载条目并过滤出正常文献 */
export async function loadRegularItems(ids, chunkSize = 500) {
  const out = [];
  const list = Array.from(ids);
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const loaded = await Zotero.Items.getAsync(chunk);
    for (const it of loaded || []) {
      if (!it || it.deleted) continue;
      if (!it.isRegularItem()) continue;
      out.push(it);
    }
  }
  return out;
}

/** 递归收集分类（含子分类）下的所有条目 ID */
export function collectCollectionItemIDs(collections) {
  const ids = new Set();
  const visited = new Set();

  const walk = (col) => {
    if (!col || visited.has(col.id)) return;
    visited.add(col.id);
    try {
      for (const id of col.getChildItems(true, false) || []) ids.add(id);
    } catch {
      /* 忽略 */
    }
    try {
      for (const sub of Zotero.Collections.getByParent(col.id, false, false) || []) {
        walk(sub);
      }
    } catch {
      /* 忽略 */
    }
  };

  for (const c of collections) walk(c);
  return ids;
}

/** 把重复组里的条目合并：保留 id 最小的那条 */
export async function mergeGroup(items) {
  const sorted = items.filter((x) => x && !x.deleted).sort((a, b) => a.id - b.id);
  if (sorted.length < 2) return { merged: 0 };
  const master = sorted[0];
  const others = sorted.slice(1);
  for (const other of others) {
    try {
      await Zotero.Items.merge(master, [other]);
    } catch {
      await Zotero.Items.merge([master, other]);
    }
  }
  return { merged: others.length };
}

/** 删除（丢进回收站）除最早一条外的其余条目 */
export async function skipGroup(items) {
  const sorted = items.filter((x) => x && !x.deleted).sort((a, b) => a.id - b.id);
  const others = sorted.slice(1);
  for (const other of others) {
    other.deleted = true;
    await other.saveTx();
  }
  return { skipped: others.length };
}

/** 用 source 的字段覆盖 target，然后删除 source */
export async function overwriteWith(target, source) {
  let fieldNames = [];
  try {
    const fieldIDs = Zotero.ItemFields.getItemTypeFields(target.itemTypeID) || [];
    fieldNames = fieldIDs.map((id) => Zotero.ItemFields.getName(id)).filter(Boolean);
  } catch {
    fieldNames = [
      'title', 'abstractNote', 'date', 'DOI', 'ISBN', 'ISSN',
      'url', 'language', 'volume', 'issue', 'pages', 'edition',
      'publicationTitle', 'journalAbbreviation', 'publisher',
      'place', 'conferenceName', 'extra',
    ];
  }

  for (const f of fieldNames) {
    if (f === 'dateAdded' || f === 'dateModified') continue;
    let val;
    try {
      val = source.getField(f);
    } catch {
      continue;
    }
    if (!val) continue;
    try {
      target.setField(f, val);
    } catch {
      /* 不支持 */
    }
  }

  try {
    const creators = source.getCreators();
    if (creators && creators.length) target.setCreators(creators);
  } catch {
    /* 忽略 */
  }

  try {
    const tags = new Set([...target.getTags(), ...source.getTags()].map((t) => t.tag));
    target.setTags([...tags]);
  } catch {
    /* 忽略 */
  }

  await target.saveTx();
  source.deleted = true;
  await source.saveTx();
}

/** 把一个 Zotero.Item 数组按组执行给定动作 */
export async function applyAction(action, items) {
  switch (action) {
    case 'skip':
      return skipGroup(items);
    case 'merge':
      return mergeGroup(items);
    case 'overwrite': {
      const sorted = items.filter((x) => x && !x.deleted).sort((a, b) => a.id - b.id);
      const master = sorted[0];
      const others = sorted.slice(1);
      for (const other of others) {
        await overwriteWith(master, other);
      }
      return { overwritten: others.length };
    }
    default:
      return { kept: Math.max(0, items.length - 1) };
  }
}
