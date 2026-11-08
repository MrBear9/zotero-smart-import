# 贡献指南

感谢你愿意参与改进！以下是几条约定。

## 开发环境

- Node.js >= 18
- Zotero 7 / 10

```bash
git clone https://github.com/MrBear9/zotero-smart-import.git
cd zotero-smart-import
npm install
npm run build
```

开发时用 `npm run watch`，改完源码自动重建 xpi。

## 目录职责

| 目录 | 职责 |
|---|---|
| `src/dedupe/` | 重复判定算法。**保持纯函数**，不碰 Zotero API，方便单测 |
| `src/core/` | Zotero API 封装。所有 `Zotero.*` 调用集中在这里 |
| `src/ui/` | DOM 对话框。不依赖 XUL |
| `src/menu/` | 右键菜单注册 |
| `addon/` | 静态资源，构建时原样拷进 xpi |

## 提交前

```bash
npm run lint
npm run build
```

确认 `dist/` 里的 xpi 能正常安装、日志无报错。

## 代码风格

- 2 空格缩进，单引号，保留分号
- 注释用中文，说明「为什么」而不是「做了什么」
- 新功能记得更新 README 的「功能」和 CHANGELOG

## 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 支持 BibTeX 导入
fix: 分类合并时漏掉子分类条目
docs: 补充 manifest 必填项说明
refactor: 把查重逻辑抽成纯函数
```

## 报告问题

提 Issue 时请附上：

1. Zotero 版本（帮助 → 关于）
2. 插件版本
3. 调试日志（帮助 → 调试输出日志，搜 `[smartimport]`）
4. 复现步骤

## 许可

提交 PR 即表示你同意以 [AGPL-3.0-or-later](LICENSE) 授权你的贡献。
