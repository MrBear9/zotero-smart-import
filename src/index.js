/**
 * Zotero Smart Import — 插件主体
 *
 * 功能：
 *   1. 导入 RIS 时自动检测重复，弹窗批量确认
 *   2. 分类右键「合并重复文献」，清理已有重复
 *   3. 识别 Zotero 自动追加时间戳的重复分类，提示合并
 *
 * 技术决策记录（踩过的坑）：
 *
 *   ✗ Zotero.Translate.Base.prototype.run
 *     Zotero 10 不存在此方法，Base.prototype 上只有 complete /
 *     _prepareTranslation / _detect 这些。
 *
 *   ✗ Zotero_File_Interface
 *     是 fileInterface.js 里的局域 var，没有挂到 window，
 *     插件作用域访问不到（ReferenceError）。
 *
 *   ✓ Zotero.Notifier
 *     Zotero 导入流程最后会 Zotero.Notifier.commit(notifierQueue)，
 *     那一刻 item.add 事件批量到达，是最好的拦截时机。
 */

/* global Zotero */

import {
  itemToPlain,
  loadRegularItems,
  collectCollectionItemIDs,
  applyAction,
} from './core/zotero-adapter.js';
import { findDuplicateGroups, stripTimestampSuffix } from './dedupe/index.js';
import { showDuplicateDialog, showConfirm } from './ui/dialog.js';
import {
  registerCollectionMenu,
  unregisterCollectionMenu,
} from './menu/collection-menu.js';

const PLUGIN_ID = 'smart-import@mrbear.dev';
const LOG = '[smartimport]';

// 可调参数
const DEBOUNCE_MS = 1500;
const BATCH_WINDOW_MS = 8000;
const FUZZY_THRESHOLD = 0.85;
const YEAR_TOLERANCE = 1;

let instance = null;

// ============================================================
// Zotero 7+ 生命周期
// ============================================================

export function install() {}

export function uninstall() {}

export function startup({ id, version }) {
  if (instance) return;
  instance = new SmartImportCore({ id, version });
  instance.startup();
}

export function shutdown() {
  if (!instance) return;
  instance.shutdown();
  instance = null;
}

// ============================================================
// 核心
// ============================================================

class SmartImportCore {
  constructor({ id, version }) {
    this.id = id || PLUGIN_ID;
    this.version = version;

    this.notifierID = null;
    this.processing = false;

    this.pendingItems = [];
    this.pendingCollections = [];
    this.debounceTimer = null;
    this.batchStartedAt = 0;
  }

  // ---------------------------------------------------------- 生命周期

  startup() {
    Zotero.debug(`${LOG} starting v${this.version}`);

    try {
      this.registerNotifier();
      Zotero.debug(`${LOG} Notifier 已注册`);
    } catch (e) {
      Zotero.logError(`${LOG} 注册 Notifier 失败: ${e}`);
    }

    try {
      const ok = registerCollectionMenu({
        pluginID: this.id,
        l10nID: 'smartimport-menu-merge-duplicates',
        onActivate: (cols) => this.onMenuActivate(cols),
      });
      if (!ok) Zotero.debug(`${LOG} 右键菜单未注册（MenuManager 不可用）`);
    } catch (e) {
      Zotero.logError(`${LOG} 注册右键菜单失败: ${e}`);
    }
  }

  shutdown() {
    Zotero.debug(`${LOG} shutting down`);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    unregisterCollectionMenu();

    if (this.notifierID) {
      try {
        Zotero.Notifier.unregisterObserver(this.notifierID);
      } catch (e) {
        Zotero.logError(`${LOG} 注销 Notifier 失败: ${e}`);
      }
      this.notifierID = null;
    }

    this.pendingItems = [];
    this.pendingCollections = [];
  }

  // ---------------------------------------------------------- Notifier

  registerNotifier() {
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids) => this.onNotify(event, type, ids),
      },
      ['item', 'collection'],
      'smart-import',
      1
    );
  }

  onNotify(event, type, ids) {
    if (this.processing) return;
    if (event !== 'add') return;

    // 同步时也会批量触发，跳过
    try {
      if (Zotero.Sync?.Runner?.running) return;
    } catch {
      /* 忽略 */
    }

    if (type === 'item') {
      for (const id of ids) {
        if (!this.pendingItems.includes(id)) this.pendingItems.push(id);
      }
    } else if (type === 'collection') {
      for (const id of ids) {
        if (!this.pendingCollections.includes(id)) this.pendingCollections.push(id);
      }
    } else {
      return;
    }

    if (!this.batchStartedAt) this.batchStartedAt = Date.now();

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushBatch().catch((e) => Zotero.logError(`${LOG} 批次处理失败: ${e}`));
    }, DEBOUNCE_MS);

    // 跨度太大强制 flush
    if (Date.now() - this.batchStartedAt > BATCH_WINDOW_MS) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.flushBatch().catch((e) => Zotero.logError(`${LOG} 强制处理失败: ${e}`));
    }
  }

  async flushBatch() {
    if (this.processing) return;

    const itemIDs = this.pendingItems.slice();
    const colIDs = this.pendingCollections.slice();
    this.pendingItems = [];
    this.pendingCollections = [];
    this.batchStartedAt = 0;

    if (!itemIDs.length && !colIDs.length) return;

    this.processing = true;
    try {
      await Zotero.Promise.delay(300);

      const rawItems = await loadRegularItems(itemIDs);
      Zotero.debug(
        `${LOG} 批次: ${itemIDs.length} 条目 / ${colIDs.length} 分类，其中 ${rawItems.length} 条为文献`
      );

      if (!rawItems.length && !colIDs.length) return;

      const libraryIDs = new Set(rawItems.map((it) => it.libraryID));
      if (!libraryIDs.size) libraryIDs.add(Zotero.Libraries.userLibraryID);

      for (const libID of libraryIDs) {
        await this.processLibrary(libID);
      }
    } catch (e) {
      Zotero.logError(`${LOG} flushBatch 异常: ${e}`);
    } finally {
      this.processing = false;
    }
  }

  // ---------------------------------------------------------- 库级处理

  async processLibrary(libraryID) {
    // 1. 重复分类
    await this.reuseDuplicateCollections(libraryID);

    // 2. 重复文献
    const plain = await this.loadLibraryItems(libraryID);
    const groups = findDuplicateGroups(plain, {
      fuzzyThreshold: FUZZY_THRESHOLD,
      yearTolerance: YEAR_TOLERANCE,
    });

    if (!groups.length) {
      Zotero.debug(`${LOG} 未发现重复`);
      return;
    }

    // 3. 弹窗确认
    const hydrated = await this.hydrateGroups(groups);
    const decisions = await showDuplicateDialog(hydrated);
    if (!decisions || decisions.cancelled) return;

    // 4. 执行
    const stats = await this.runDecisions(hydrated, decisions);
    this.notify(
      `重复处理：跳过 ${stats.skipped}，合并 ${stats.merged}，` +
        `覆盖 ${stats.overwritten}，保留 ${stats.kept}`
    );
  }

  async loadLibraryItems(libraryID) {
    const rows = await Zotero.DB.queryAsync(
      `SELECT i.itemID
         FROM items i
        WHERE i.libraryID = ?
          AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
      [libraryID]
    );
    const ids = (rows || []).map((r) => r.itemID);
    const items = await loadRegularItems(ids);
    return items.map(itemToPlain);
  }

  /** 把纯数据的 item 换回 Zotero.Item，供 UI 显示 */
  async hydrateGroups(groups) {
    const out = [];
    for (const g of groups) {
      const ids = g.items.map((x) => x.id);
      const items = await Zotero.Items.getAsync(ids);
      const valid = (items || []).filter(Boolean).sort((a, b) => a.id - b.id);
      if (valid.length < 2) continue;
      out.push({ key: g.key, reason: g.reason, items: valid });
    }
    return out;
  }

  // ---------------------------------------------------------- 重复分类

  /**
   * Zotero 导入时若已有同名分类，会新建「光计算 2026/11/8 18:30:00」。
   * 这里找出这类分类，问用户是否并入原名分类。
   */
  async reuseDuplicateCollections(libraryID) {
    let cols;
    try {
      cols = Zotero.Collections.getByLibrary(libraryID, false, false) || [];
    } catch (e) {
      Zotero.logError(`${LOG} 读取分类失败: ${e}`);
      return;
    }
    if (!cols.length) return;

    const byName = new Map();
    for (const c of cols) {
      const k = c.name.trim();
      if (!byName.has(k)) byName.set(k, c);
    }

    const toMerge = [];
    for (const c of cols) {
      const stripped = stripTimestampSuffix(c.name);
      if (!stripped) continue;
      const target = byName.get(stripped);
      if (!target || target.id === c.id) continue;

      let childCount = 0;
      try {
        childCount = c.getChildItems(true, false).length;
      } catch {
        continue;
      }
      if (!childCount) continue;

      toMerge.push({ from: c, to: target });
    }

    if (!toMerge.length) return;

    const names = toMerge.map((m) => `  「${m.from.name}」 → 「${m.to.name}」`).join('\n');
    const ok = await showConfirm(
      '发现重复分类',
      `Zotero 导入时为以下分类自动加了时间戳：\n\n${names}\n\n` +
        `是否把条目并入原有分类，并删除这些重复分类？`,
      ['合并', '保留原样']
    );
    if (!ok) return;

    for (const { from, to } of toMerge) {
      try {
        const itemIDs = from.getChildItems(true, false);
        if (itemIDs?.length) await to.addItems(itemIDs);

        const subs = Zotero.Collections.getByParent(from.id, false, false) || [];
        for (const sub of subs) {
          sub.parentID = to.id;
          await sub.saveTx();
        }
        await from.eraseTx();
        Zotero.debug(`${LOG} 分类已合并: ${from.name} → ${to.name}`);
      } catch (e) {
        Zotero.logError(`${LOG} 合并分类失败 ${from.name}: ${e}`);
      }
    }
  }

  // ---------------------------------------------------------- 右键菜单

  async onMenuActivate(collections) {
    try {
      const itemIDs = collectCollectionItemIDs(collections);
      if (!itemIDs.size) {
        this.notify('选中的分类里没有条目');
        return;
      }

      const scopeNames = collections.map((c) => c.name).join('、');
      Zotero.debug(`${LOG} 扫描范围: ${scopeNames}，共 ${itemIDs.size} 条`);

      const rawItems = await loadRegularItems(itemIDs);
      const plain = rawItems.map(itemToPlain);

      const groups = findDuplicateGroups(plain, {
        fuzzyThreshold: FUZZY_THRESHOLD,
        yearTolerance: YEAR_TOLERANCE,
      });

      if (!groups.length) {
        this.notify(`「${scopeNames}」中未发现重复文献`);
        return;
      }

      const hydrated = await this.hydrateGroups(groups);
      const decisions = await showDuplicateDialog(
        hydrated,
        `在「${scopeNames}」中发现 ${hydrated.length} 组重复`
      );
      if (!decisions || decisions.cancelled) return;

      const stats = await this.runDecisions(hydrated, decisions);
      this.notify(
        `合并完成：跳过 ${stats.skipped}，合并 ${stats.merged}，` +
          `覆盖 ${stats.overwritten}，保留 ${stats.kept}`
      );
    } catch (e) {
      Zotero.logError(`${LOG} 合并重复失败: ${e}`);
      this.notify('合并失败，详见错误控制台');
    }
  }

  // ---------------------------------------------------------- 执行

  async runDecisions(groups, decisions) {
    const stats = { skipped: 0, merged: 0, overwritten: 0, kept: 0 };

    for (const g of groups) {
      const action = decisions[g.key] || 'skip';
      const items = (g.items || []).filter((x) => x && !x.deleted);
      if (items.length < 2) continue;

      try {
        const r = await applyAction(action, items);
        if (r.skipped) stats.skipped += r.skipped;
        if (r.merged) stats.merged += r.merged;
        if (r.overwritten) stats.overwritten += r.overwritten;
        if (r.kept) stats.kept += r.kept;
      } catch (e) {
        Zotero.logError(`${LOG} 处理失败 (${action}): ${e}`);
      }
    }
    return stats;
  }

  // ---------------------------------------------------------- 通知

  notify(message) {
    try {
      const pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline('Zotero Smart Import');
      pw.addDescription(message);
      pw.show();
      pw.startCloseTimer(5000);
    } catch {
      Zotero.debug(`${LOG} ${message}`);
    }
  }
}
