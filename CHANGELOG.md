# 更新日志

本项目的所有重要变更都会记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [1.0.0] - 2026-11-08

### 新增

- 导入 RIS / BibTeX 后自动检测重复文献，弹窗批量确认
- 重复判定支持 DOI 精确、ISBN 精确、标题+作者+年份模糊三档
- 分类右键菜单「合并重复文献…」，可对任意分类（含子分类）做重复清理
- 识别 Zotero 导入时自动追加时间戳的重复分类，提示合并
- 处理方式支持跳过 / 合并 / 覆盖 / 都保留
- 批量操作：全部跳过、全部保留
- 中英文界面

### 技术决策

- 采用 `Zotero.Notifier` 作为导入钩子（`Translate.Base.prototype.run` 在 Zotero 10 不存在；`Zotero_File_Interface` 是局域变量无法访问）
- 菜单使用官方 `Zotero.MenuManager` API
- 自研极简 ESM bundler，无运行时依赖

[未发布]: https://github.com/MrBear9/zotero-smart-import/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/MrBear9/zotero-smart-import/releases/tag/v1.0.0
