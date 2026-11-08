# 踩坑记录

开发这个插件时踩过的坑，都记在这里。Zotero 的报错信息经常是误导性的，
真正的根因往往在别处。

---

## 一、Zotero 插件 API 相关

### 1. `Zotero.Translate.Base.prototype.run` 不存在

**现象**：挂钩后代码完全不执行，没有任何报错。

**原因**：Zotero 10 的 `Base.prototype` 上只有这些方法：

```
init, setLocation, setTranslator, setHandler, clearHandlers,
removeHandler, setTranslatorProvider, incrementAsyncProcesses,
decrementAsyncProcesses, _runHandler, getProgress, resolveURL,
complete, _cleanTitle, _cleanTags, _checkIfDone, _detect,
_detectTranslatorLoaded, _detectTranslatorsCollected, _generateSandbox,
...
```

**没有 `run`**。挂上去就是 `undefined`，赋值时静默失败。

**正确做法**：用 `Zotero.Notifier` 监听 `item.add`。

---

### 2. `Zotero_File_Interface` 是局域变量

**现象**：
```
ReferenceError: Zotero_File_Interface is not defined
```

**原因**：`fileInterface.js` 里这么定义的：

```js
var Zotero_File_Interface = new function () { ... }
```

`var` 声明在文件作用域，**没有挂到 `window`**。插件跑在独立的作用域里，访问不到。

**结论**：这条路走不通。改用 `Zotero.Notifier`。

---

### 3. 导入流程的真实结构

翻 `fileInterface.js` 源码整理出来的：

```
Zotero_File_Interface.importFile()
  → _finishImport()          ← 闭包内的私有函数，无法挂钩
    → translation.translate({
        saveOptions: { notifierQueue }   ← 通知先进队列
      })
    → finally { await Zotero.Notifier.commit(notifierQueue) }   ← 批量发出
```

**关键点**：`item.add` 通知会在导入结束时**批量到达**，不是逐条即时触发。
所以要用 debounce 聚合，不能指望每加一条就处理一次。

---

### 4. 分类重名时 Zotero 会自动加时间戳

`_finishImport` 里的逻辑：

```js
let allCollections = Zotero.Collections.getByLibrary(libraryID);
for (var i = 0; i < allCollections.length; i++) {
  if (allCollections[i].name == collectionName) {
    collectionName += " " + new Date().toLocaleString();
    break;
  }
}
```

所以导入两次「光计算」，第二次会变成：

```
光计算 2026/11/8 18:30:00
```

插件要识别这个后缀才能合并回原分类。

---

### 5. `Collection.getChildItems()` 的第一个参数

**签名**：`getChildItems(asIDs, includeTrashed)`

漏掉第一个参数会拿到 `Zotero.Item` 对象数组，不是 ID 数组。传给 `addItems()` 会出错。

```js
// 错
const ids = col.getChildItems();

// 对
const ids = col.getChildItems(true, false);
```

---

### 6. `Collections.getByLibrary` 的参数

**签名**：`getByLibrary(libraryID, recursive, includeTrashed)`

```js
// 错（第二个参数应该是 boolean）
Zotero.Collections.getByLibrary(libID, false);

// 对
Zotero.Collections.getByLibrary(libID, false, false);
```

---

### 7. `Zotero.Item.prototype.getFieldNames()` 不存在

覆盖字段时需要遍历可用字段，这个方法**没有**。

**正确做法**：

```js
const fieldIDs = Zotero.ItemFields.getItemTypeFields(item.itemTypeID);
const names = fieldIDs.map(id => Zotero.ItemFields.getName(id));
```

---

## 二、Manifest 相关

### 8. `applications.zotero` 的三个必填项

Zotero 的 `Extension.sys.mjs` 里硬性校验：

```js
if (!manifest.applications?.zotero?.id) {
  this.manifestError("applications.zotero.id not provided");
}
if (!manifest.applications?.zotero?.update_url) {
  this.manifestError("applications.zotero.update_url not provided");
}
if (!manifest.applications?.zotero?.strict_max_version) {
  this.manifestError("applications.zotero.strict_max_version not provided");
}
```

**缺任何一项，Zotero 都只显示「可能无法与该版本的 Zotero 兼容」**，不告诉你缺了什么。

`update_url` 最容易漏，即使不做在线更新也必须写。

---

### 9. `__MSG_` 占位符需要 `default_locale`

**现象**：插件安装被拒，提示「无法兼容」。

**原因**：manifest 用了占位符但没配 `default_locale`：

```json
"name": "__MSG_addonName__"     // ← 需要 default_locale
```

Zotero 的逻辑：

```js
if (manifest.default_locale) {   // ← 没有就跳过
  await this.initLocale();
}
```

占位符没被替换 → manifest 无效 → 判定不兼容。

**正确做法**：直接写字符串，别用占位符。或者老老实实加 `default_locale` + `_locales/{locale}/messages.json`。

---

### 10. `strict_max_version` 不能用 `10.*`

虽然参考项目里有写 `11.*` 能用的，但 `10.*` 在 Zotero 10.0.8 上被判不兼容。

**保险做法**：写精确版本 `10.9.9`。

---

## 三、菜单 API 相关

### 11. `MenuManager` 的 menuitem 不支持 `label`

`_menusTypeDefinition` 里定义的合法字段：

```
menuType, l10nID, l10nArgs, icon, darkIcon,
onShowing, onShown, onHiding, onHidden, onCommand, menus
```

**没有 `label`**。文字只能通过 `l10nID` 走 Fluent。

**变通做法**：在 `onShowing` 里直接设属性：

```js
onShowing: (_ev, context) => {
  context?.menuElem?.setAttribute('label', '合并重复文献…');
}
```

---

### 12. 分类菜单的 context 里没有 `collection`

`main/library/collection` 的 context 结构：

```js
{
  get collectionTreeRow() { ... },   // 已弃用
  collectionTreeRows: [...],         // 用这个
  tabType: "library",
  tabID: "zotero-pane"
}
```

每行的 `.ref` 才是 collection 对象。库根节点没有 `addItems` 方法，要过滤。

---

## 四、构建与 CI 相关

### 13. GitHub Actions 的 ubuntu-latest 没有 PowerShell

**现象**：CI 里 build 步骤显示成功，但 `dist/` 是空的，后续步骤全挂。

**原因**：`build.mjs` 用了：

```js
execSync(`powershell -NoProfile -Command "Compress-Archive ..."`);
```

Linux 上没有 `powershell`，`execSync` 抛异常，但被 `catch` 吞了只打印一行，**函数正常返回**。

**教训**：构建脚本出错必须 `process.exit(1)`，不能吞异常。

**解决**：写了 `scripts/zip.mjs`，用 Node 内置 `zlib` 实现 ZIP 打包，跨平台一致。

---

### 14. `npm ci` 需要 `package-lock.json`

没有 lock 文件时 `npm ci` 直接失败。

**解决**：`npm install --package-lock-only` 生成并提交。

---

### 15. ESLint 9 移除了 `--ext`

```bash
# 错
eslint src scripts --ext .js,.mjs

# 对（直接传目录）
eslint src scripts
```

---

### 16. ESLint 需要显式声明 `setTimeout` 等全局

CI 里 lint 报错：

```
'setTimeout' is not defined    no-undef
```

浏览器全局在 ESLint 里不是默认的，要在 config 里列出来：

```js
globals: {
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  Zotero: 'readonly',
  // ...
}
```

---

### 17. `update_url` 要指向固定路径

**错误示范**：

```
.../releases/download/release/update.json
```

如果 workflow 按版本打 tag（`v1.0.1`、`v1.0.2`），`update.json` 会跑到各版本的目录下，`.../download/release/` 永远是 404。

**正确做法**：维护一个固定的 `release` tag，每次发布移动它、更新同一个 Release。

```yaml
- run: |
    git tag -f release
    git push -f origin release
```

---

## 五、调试经验

### 18. 手动放入 xpi 必须重启

Zotero 在**启动时**扫描 `extensions/` 目录。运行中放进去的文件不会被识别。

`addonStartup.json.lz4` 的修改时间可以判断上次扫描是什么时候。

### 19. 用假环境跑 bundle

`build/bootstrap.js` 是打包产物，语法检查通过不代表能跑。

可以用 Node 的 `vm` 模块加一个假 `Zotero` 对象验证：

```js
const sandbox = {
  Zotero: {
    debug: (m) => console.log(m),
    Notifier: { registerObserver: () => 'id' },
    MenuManager: { registerMenu: (o) => console.log(o.menuID) },
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
sandbox.startup({ id: 'x', version: '1.0.0' });
```

能跑出 `starting v1.0.0` 就说明模块加载和生命周期都正常。

### 20. 报错信息会骗人

「可能无法与该版本的 Zotero 兼容」这一个提示，对应了至少三种完全不同的原因：

- manifest 缺 `update_url`
- manifest 用了占位符但没 `default_locale`
- `strict_max_version` 格式不对

**别只看提示，要翻源码找校验逻辑。**

---

## 附：快速排查清单

装不上时按顺序查：

1. `unzip -l xxx.xpi` 看 `manifest.json` 在不在根部
2. 看 manifest 有没有 `id` / `update_url` / `strict_max_version`
3. `name` / `description` 是不是 `__MSG_` 开头
4. `strict_max_version` 是不是精确版本号
5. `icons` 指向的文件在不在包里
6. 帮助 → 调试输出日志，看有没有 manifest 相关报错
7. `extensions.json` 里有没有这条记录，`active` 是不是 `true`

装上了但不工作：

1. `[smartimport]` 开头的日志有没有
2. `Zotero.debug()` 默认级别可能不显示，调 `debug.log.loglevel = 5`
3. 右键分类看菜单项在不在
4. 导入一次 RIS 看有没有弹窗
