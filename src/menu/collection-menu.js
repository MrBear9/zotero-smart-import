/**
 * 分类右键菜单
 *
 * 用 Zotero 官方 MenuManager API 在分类上挂「合并重复文献」。
 * target: "main/library/collection"
 */

/* global Zotero */

export const MENU_ID = 'smart-import-merge-duplicates';
export const MENU_TARGET = 'main/library/collection';

/**
 * 注册菜单。
 *
 * @param {object} opts
 * @param {string} opts.pluginID - 插件 ID
 * @param {string} opts.l10nID - Fluent 消息 ID
 * @param {(cols: Array) => Promise<void>} opts.onActivate - 点击回调
 * @returns {boolean} 是否注册成功
 */
export function registerCollectionMenu({ pluginID, l10nID, onActivate }) {
  if (!Zotero.MenuManager) {
    Zotero.debug('[smartimport] Zotero.MenuManager 不可用，跳过右键菜单');
    return false;
  }

  // MenuManager 的 menuitem 不认 label 属性，只认 l10nID + Fluent。
  // 如果 Fluent 文件没加载，菜单会是空白，所以这里额外兜底设置文字。
  const FALLBACK_LABEL = '合并重复文献…';

  const setupLabel = (elem) => {
    if (!elem) return;
    if (elem.getAttribute('label')) return;
    elem.setAttribute('label', FALLBACK_LABEL);
  };

  Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID,
    target: MENU_TARGET,
    menus: [
      {
        menuType: 'menuitem',
        l10nID,
        onShowing: (_ev, context) => {
          const cols = collectionsFromContext(context);
          setupLabel(context?.menuElem);
          context?.setVisible?.(cols.length > 0);
          context?.setEnabled?.(cols.length > 0);
        },
        onCommand: async (_ev, context) => {
          const cols = collectionsFromContext(context);
          if (!cols.length) return;
          await onActivate(cols);
        },
      },
    ],
  });

  Zotero.debug('[smartimport] 分类右键菜单已注册');
  return true;
}

/** 注销菜单 */
export function unregisterCollectionMenu() {
  try {
    if (Zotero.MenuManager) {
      Zotero.MenuManager.unregisterMenu(MENU_ID);
    }
  } catch (e) {
    Zotero.logError(`[smartimport] 注销菜单失败: ${e}`);
  }
}

/**
 * 从菜单 context 里取出真正的 Collection 对象。
 *
 * Zotero 10 的 context 只有 collectionTreeRows，每行的 .ref 才是 collection。
 * 库根节点没有 addItems 方法，要过滤掉。
 */
export function collectionsFromContext(context) {
  const rows = context?.collectionTreeRows || [];
  const out = [];
  for (const row of rows) {
    const ref = row?.ref;
    if (!ref) continue;
    if (typeof ref.addItems !== 'function') continue;
    if (typeof ref.getChildItems !== 'function') continue;
    out.push(ref);
  }
  return out;
}
