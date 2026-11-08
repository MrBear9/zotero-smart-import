# Zotero Smart Import

[English](#english) | [简体中文](#简体中文)

---

## 简体中文

导入 RIS 文件时自动检测重复文献，并复用已有的同名分类。也可以随时对任意分类做一次重复清理。

### 功能

**1. 导入时自动查重**

导入 RIS 后，插件会扫描整个文献库，找出重复条目，弹窗让你批量处理。

**2. 分类右键清理**

在左侧分类上右键 → **合并重复文献…**，扫描该分类（含所有子分类）内的重复项。

**3. 重复分类识别**

Zotero 导入时会这样命名分类：

```
第一次导入 → 光计算
第二次导入 → 光计算 2026/11/8 18:30:00
```

插件能识别这个时间戳后缀，问你合并到原分类。

### 重复判定规则

按优先级依次尝试：

| 优先级 | 规则 | 说明 |
|---|---|---|
| 1 | **DOI 精确** | 归一化后完全相同（去掉 `https://doi.org/`、`doi:` 前缀） |
| 2 | **ISBN 精确** | 去掉连字符后完全相同 |
| 3 | **标题模糊** | 标题 Dice 相似度 ≥ 85%，年份差 ≤ 1，作者姓氏至少一个重合 |

### 处理方式

检测到重复后，每条可以选：

- **跳过** — 删除新导入的副本，保留原有的（默认）
- **合并** — 保留原有条目，把新条目的独有信息合并进来（走 Zotero 官方 merge）
- **覆盖** — 用新数据的字段替换旧条目，标签取并集
- **都保留** — 不做处理

支持「全部跳过」/「全部保留」批量设置。取消勾选的行按「都保留」处理。

### 安装

**从 Release 安装（推荐）**

1. 下载最新的 `smartimport-x.y.z.xpi`
2. Zotero → 工具 → 插件 → 齿轮 → 从文件安装
3. 重启 Zotero

**从源码构建**

```bash
git clone https://github.com/MrBear9/zotero-smart-import.git
cd zotero-smart-import
npm install
npm run build
```

产物在 `dist/smartimport-<version>.xpi`。

### 开发

```bash
npm run build      # 构建
npm run build:dev  # 构建（不压缩）
npm run watch      # 监听源码变化
npm run lint       # 代码检查
npm run clean      # 清理产物
```

### 项目结构

```
.
├── addon/                 # 静态资源（原样拷进 xpi）
│   ├── manifest.json      # 插件清单
│   ├── _locales/          # 插件名/描述多语言
│   ├── locale/            # Fluent 本地化（菜单文字）
│   ├── content/
│   │   └── icons/
│   └── prefs.js           # 默认偏好
├── src/                   # 源码（构建时打包成 bootstrap.js）
│   ├── index.js           # 入口：生命周期 + 主流程
│   ├── core/
│   │   └── zotero-adapter.js   # Zotero API 封装
│   ├── dedupe/
│   │   └── index.js       # 重复判定算法（纯函数）
│   ├── menu/
│   │   └── collection-menu.js  # 分类右键菜单
│   └── ui/
│       └── dialog.js      # 对话框
├── scripts/
│   └── build.mjs          # 构建脚本（极简 ESM bundler）
└── .github/workflows/     # CI 发布
```

### 技术说明

**为什么不用 `Zotero.Translate.Base.prototype.run`？**

Zotero 10 的 `Base.prototype` 上没有 `run` 方法，只有 `complete`、`_prepareTranslation`、`_detect` 等。挂上去是 `undefined`。

**为什么不用 `Zotero_File_Interface`？**

它是 `fileInterface.js` 里的局域 `var`，没挂到 `window`，插件作用域访问会抛 `ReferenceError`。

**实际采用的方案：`Zotero.Notifier`**

```
Zotero_File_Interface.importFile()
  → _finishImport()
    → translation.translate({ saveOptions: { notifierQueue } })   ← 通知进队列
    → Zotero.Notifier.commit(notifierQueue)                      ← 批量发出
```

导入结束时 `item.add` 会集中到达，用 debounce 聚合成一批再处理。

**菜单文字的坑**

`Zotero.MenuManager` 的 `menuitem` **不支持 `label` 属性**，合法字段只有：

```
menuType, l10nID, l10nArgs, icon, darkIcon,
onShowing, onShown, onHiding, onHidden, onCommand, menus
```

文字必须走 `l10nID` + Fluent。本项目在 `addon/locale/` 下提供了 `.ftl` 文件，同时在 `onShowing` 里做了兜底。

**manifest 必填项**

Zotero 要求 `applications.zotero` 下**必须**有这三项，缺任一项都会报「无法兼容」：

- `id`
- `update_url` ← 最容易漏，即使不做在线更新也要写
- `strict_max_version` ← 要用精确版本号，`10.*` 写法无效

### 配置

首选项 → 高级 → 配置编辑器，搜索 `extensions.zotero.smartimport`：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `fuzzyThreshold` | `0.85` | 标题相似度阈值 |
| `yearTolerance` | `1` | 年份容差 |
| `debounceMs` | `1500` | 批次整合等待时间 |

### 已知限制

- 分类信息不来自 RIS 文件本身（RIS 标准没有分类字段），以导入向导里选的分类为准
- 只在检测到批量 `item.add` 时触发，单条手动添加不会触发
- 模糊匹配对中英文都有效，但标题极短（< 5 字符）时只做精确匹配
- 大库首次扫描可能较慢（5000 条以上建议用分类右键分范围处理）

### 调试

帮助 → 调试输出日志，搜索 `[smartimport]`。

### 致谢

- [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags) — 项目结构参考
- [Zotero](https://www.zotero.org/) — 优秀的开源文献管理工具

### 许可

[AGPL-3.0-or-later](LICENSE)

---

## English

Automatically detect duplicate items when importing RIS files, and reuse existing collections. You can also clean up duplicates in any collection at any time.

### Features

**1. Auto-detect on import**

After importing a RIS file, the plugin scans your library for duplicates and shows a batch dialog.

**2. Collection context menu**

Right-click any collection → **Merge Duplicate Items…** to scan that collection (including subcollections).

**3. Duplicate collection detection**

Zotero renames collections on conflict:

```
First import  → 光计算
Second import → 光计算 2026/11/8 18:30:00
```

The plugin strips that timestamp suffix and offers to merge into the original.

### Duplicate matching rules

Tried in priority order:

| Priority | Rule | Detail |
|---|---|---|
| 1 | **DOI exact** | Normalized match (strips `https://doi.org/`, `doi:`) |
| 2 | **ISBN exact** | Hyphens removed |
| 3 | **Title fuzzy** | Dice similarity ≥ 85%, year within ±1, at least one shared author surname |

### Actions

For each duplicate group:

- **Skip** — delete the newly imported copy, keep the original (default)
- **Merge** — keep original, fold in unique fields from the new one (uses Zotero's merge)
- **Overwrite** — replace old fields with new data, tags unioned
- **Keep both** — do nothing

Bulk buttons: **Skip all** / **Keep all**. Unchecked rows are treated as "Keep both".

### Installation

**From Release (recommended)**

1. Download the latest `smartimport-x.y.z.xpi`
2. Zotero → Tools → Add-ons → gear → Install Add-on From File
3. Restart Zotero

**Build from source**

```bash
git clone https://github.com/MrBear9/zotero-smart-import.git
cd zotero-smart-import
npm install
npm run build
```

Output: `dist/smartimport-<version>.xpi`

### Development

```bash
npm run build      # build
npm run build:dev  # build without minification
npm run watch      # watch source changes
npm run lint       # lint
npm run clean      # clean artifacts
```

### Technical notes

**Why not `Zotero.Translate.Base.prototype.run`?**

In Zotero 10, `Base.prototype` has no `run` method — only `complete`, `_prepareTranslation`, `_detect`, etc.

**Why not `Zotero_File_Interface`?**

It is a local `var` inside `fileInterface.js`, not exposed on `window`. Accessing it from a plugin throws `ReferenceError`.

**The approach used: `Zotero.Notifier`**

```
Zotero_File_Interface.importFile()
  → _finishImport()
    → translation.translate({ saveOptions: { notifierQueue } })   ← notifications queued
    → Zotero.Notifier.commit(notifierQueue)                      ← flushed in bulk
```

At import end, `item.add` fires in a burst. Debounce them into one batch, then process.

**The menu label gotcha**

`Zotero.MenuManager` menuitems **do not accept a `label` attribute**. Valid fields are:

```
menuType, l10nID, l10nArgs, icon, darkIcon,
onShowing, onShown, onHiding, onHidden, onCommand, menus
```

Labels must come from `l10nID` + Fluent. This project ships `.ftl` files under `addon/locale/` and also sets a fallback in `onShowing`.

**Required manifest fields**

Zotero requires all three under `applications.zotero`, otherwise it reports "incompatible":

- `id`
- `update_url` ← most commonly missed, required even without auto-update
- `strict_max_version` ← must be an exact version; `10.*` does not work

### Configuration

Preferences → Advanced → Config Editor, search `extensions.zotero.smartimport`:

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch |
| `fuzzyThreshold` | `0.85` | Title similarity threshold |
| `yearTolerance` | `1` | Year tolerance |
| `debounceMs` | `1500` | Batch aggregation delay |

### Known limitations

- Collection info does not come from the RIS file (RIS has no standard collection field); the collection chosen in the import wizard is used
- Triggers only on bulk `item.add`, not on single manual additions
- Fuzzy matching works for CJK and Latin titles, but very short titles (< 5 chars) use exact matching only
- First scan of a large library may be slow; use the collection context menu to scope it

### Debugging

Help → Debug Output Logging, search `[smartimport]`.

### Credits

- [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags) — project structure reference
- [Zotero](https://www.zotero.org/) — excellent open-source reference manager

### License

[AGPL-3.0-or-later](LICENSE)
