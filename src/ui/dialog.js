/**
 * DOM 对话框
 *
 * 不依赖 XUL，纯 XHTML 元素，在 Zotero 主窗口里以 overlay 形式呈现。
 */

/* global Zotero */

const NS = 'http://www.w3.org/1999/xhtml';

function el(doc, tag, props = {}, style = {}) {
  const n = doc.createElementNS(NS, tag);
  Object.assign(n, props);
  Object.assign(n.style, style);
  return n;
}

/**
 * 批量确认对话框。
 *
 * @param {Array<{key, items, reason}>} groups
 * @param {string} [customTitle]
 * @returns {Promise<Record<string, string>|{cancelled:true}>}
 */
export function showDuplicateDialog(groups, customTitle) {
  return new Promise((resolve) => {
    const win = Zotero.getMainWindow();
    if (!win) return resolve({ cancelled: true });
    const doc = win.document;

    const overlay = el(doc, 'div', {}, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.45)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    });

    const panel = el(doc, 'div', {}, {
      background: 'var(--material-background, #fff)',
      color: 'var(--fill-primary, #222)',
      borderRadius: '10px',
      boxShadow: '0 14px 44px rgba(0,0,0,0.4)',
      width: 'min(900px, 94vw)',
      maxHeight: '86vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    // 头部
    const header = el(doc, 'div', {}, {
      padding: '16px 20px 12px',
      borderBottom: '1px solid rgba(128,128,128,0.25)',
      flex: '0 0 auto',
    });
    header.appendChild(
      el(doc, 'div', { textContent: customTitle || `发现 ${groups.length} 组重复文献` }, {
        fontSize: '16px',
        fontWeight: '600',
      })
    );
    header.appendChild(
      el(doc, 'div', {
        textContent: '勾选要处理的条目（不勾选=原样保留）。默认动作为「跳过」，即删除新导入的副本。',
      }, { fontSize: '12px', opacity: '0.7', marginTop: '4px' })
    );
    panel.appendChild(header);

    // 列表
    const list = el(doc, 'div', {}, {
      overflowY: 'auto',
      padding: '10px 20px',
      flex: '1 1 auto',
    });

    const decisions = {};
    const checks = [];

    for (const g of groups) {
      const items = g.items || [];
      decisions[g.key] = 'skip';

      const row = el(doc, 'div', {}, {
        padding: '12px 0',
        borderBottom: '1px solid rgba(128,128,128,0.15)',
      });

      // 标题行
      const head = el(doc, 'div', {}, { display: 'flex', gap: '8px', alignItems: 'flex-start' });
      const chk = el(doc, 'input', { type: 'checkbox', checked: true }, {
        marginTop: '3px',
        flex: '0 0 auto',
      });
      chk.dataset.key = g.key;
      checks.push(chk);
      head.appendChild(chk);

      const info = el(doc, 'div', {}, { flex: '1 1 auto', minWidth: '0' });
      info.appendChild(
        el(doc, 'div', { textContent: fieldOf(items[0], 'title') || '(无标题)' }, {
          fontWeight: '600',
          fontSize: '13px',
          wordBreak: 'break-word',
        })
      );
      info.appendChild(
        el(doc, 'div', { textContent: `依据：${g.reason}　·　${items.length} 条` }, {
          fontSize: '11px',
          opacity: '0.65',
          marginTop: '2px',
        })
      );
      head.appendChild(info);
      row.appendChild(head);

      // 明细
      const detail = el(doc, 'div', {}, {
        marginLeft: '24px',
        marginTop: '6px',
        fontSize: '11px',
        opacity: '0.75',
      });
      items.forEach((it, idx) => {
        const meta = [
          `#${it.id}`,
          fieldOf(it, 'date'),
          fieldOf(it, 'publicationTitle') || fieldOf(it, 'publisher'),
        ]
          .filter(Boolean)
          .join(' · ');
        detail.appendChild(
          el(doc, 'div', { textContent: `${idx === 0 ? '保留' : '处理'}：${meta}` }, {
            marginBottom: '2px',
          })
        );
      });
      row.appendChild(detail);

      // 动作单选
      const actions = el(doc, 'div', {}, {
        display: 'flex',
        gap: '14px',
        marginLeft: '24px',
        marginTop: '8px',
        fontSize: '12px',
        flexWrap: 'wrap',
      });
      const opts = [
        ['skip', '跳过（删副本）'],
        ['merge', '合并'],
        ['overwrite', '覆盖'],
        ['keep', '都保留'],
      ];
      opts.forEach(([val, label], i) => {
        const wrap = el(doc, 'label', {}, {
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          cursor: 'pointer',
        });
        const radio = el(doc, 'input', {
          type: 'radio',
          name: `rsi-${g.key}`,
          value: val,
          checked: i === 0,
        });
        radio.addEventListener('change', () => {
          if (radio.checked) {
            decisions[g.key] = val;
            chk.checked = true;
          }
        });
        wrap.appendChild(radio);
        wrap.appendChild(el(doc, 'span', { textContent: label }));
        actions.appendChild(wrap);
      });
      row.appendChild(actions);

      list.appendChild(row);
    }

    panel.appendChild(list);

    // 底部
    const footer = el(doc, 'div', {}, {
      padding: '12px 20px',
      borderTop: '1px solid rgba(128,128,128,0.25)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
    });

    const mkBtn = (label, primary = false) => {
      const b = el(doc, 'button', { textContent: label }, {
        padding: '6px 14px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
      });
      if (primary) {
        b.style.background = '#2b6cb0';
        b.style.color = '#fff';
        b.style.border = 'none';
        b.style.fontWeight = '600';
      }
      return b;
    };

    const left = el(doc, 'div', {}, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
    const btnAllSkip = mkBtn('全部跳过');
    const btnAllKeep = mkBtn('全部保留');

    const setAll = (val) => {
      for (const g of groups) {
        decisions[g.key] = val;
        const r = panel.querySelector(`input[name="rsi-${g.key}"][value="${val}"]`);
        if (r) r.checked = true;
      }
      checks.forEach((c) => (c.checked = true));
    };
    btnAllSkip.addEventListener('click', () => setAll('skip'));
    btnAllKeep.addEventListener('click', () => setAll('keep'));

    left.appendChild(btnAllSkip);
    left.appendChild(btnAllKeep);

    const right = el(doc, 'div', {}, { display: 'flex', gap: '10px' });
    const btnCancel = mkBtn('稍后处理');
    const btnOk = mkBtn('执行', true);

    const close = (result) => {
      try {
        overlay.remove();
        doc.removeEventListener('keydown', onKey, true);
      } catch {
        /* 忽略 */
      }
      resolve(result);
    };

    btnCancel.addEventListener('click', () => close({ cancelled: true }));
    btnOk.addEventListener('click', () => {
      const final = {};
      for (const g of groups) {
        const c = checks.find((x) => x.dataset.key === g.key);
        final[g.key] = c && c.checked ? decisions[g.key] : 'keep';
      }
      close(final);
    });

    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close({ cancelled: true });
      }
    };
    doc.addEventListener('keydown', onKey, true);

    right.appendChild(btnCancel);
    right.appendChild(btnOk);
    footer.appendChild(left);
    footer.appendChild(right);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    doc.documentElement.appendChild(overlay);
  });
}

/** 简单确认框，返回 true/false */
export function showConfirm(title, message, buttons) {
  return new Promise((resolve) => {
    const win = Zotero.getMainWindow();
    if (!win) return resolve(false);
    const doc = win.document;

    const overlay = el(doc, 'div', {}, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.45)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    });

    const panel = el(doc, 'div', {}, {
      background: 'var(--material-background, #fff)',
      color: 'var(--fill-primary, #222)',
      borderRadius: '10px',
      boxShadow: '0 14px 44px rgba(0,0,0,0.4)',
      padding: '18px 22px',
      width: 'min(480px, 92vw)',
    });

    panel.appendChild(
      el(doc, 'div', { textContent: title }, {
        fontSize: '15px',
        fontWeight: '600',
        marginBottom: '10px',
      })
    );
    panel.appendChild(
      el(doc, 'div', { textContent: message }, {
        fontSize: '13px',
        lineHeight: '1.7',
        whiteSpace: 'pre-wrap',
        opacity: '0.85',
        maxHeight: '50vh',
        overflowY: 'auto',
      })
    );

    const btns = el(doc, 'div', {}, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '10px',
      marginTop: '18px',
    });

    const mk = (label, val, primary = false) => {
      const b = el(doc, 'button', { textContent: label }, {
        padding: '6px 16px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
      });
      if (primary) {
        b.style.background = '#2b6cb0';
        b.style.color = '#fff';
        b.style.border = 'none';
        b.style.fontWeight = '600';
      }
      b.addEventListener('click', () => {
        overlay.remove();
        resolve(val);
      });
      return b;
    };

    btns.appendChild(mk((buttons && buttons[1]) || '否', false));
    btns.appendChild(mk((buttons && buttons[0]) || '是', true, true));

    panel.appendChild(btns);
    overlay.appendChild(panel);
    doc.documentElement.appendChild(overlay);
  });
}

/** 安全读字段：兼容 Zotero.Item 和纯数据对象 */
function fieldOf(it, name) {
  if (!it) return '';
  try {
    if (typeof it.getField === 'function') return it.getField(name) || '';
  } catch {
    /* 落到下面 */
  }
  return it[name] || '';
}
