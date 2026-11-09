# PaperDesk v0.3.0 — 第一个版本

给 DeepSeek Harness 的 Mendeley 式论文库：PDF 导入、面板内阅读与批注、Agent 精读、笔记卡片、
多篇论文对比、带类型的论文关系图谱，以及交给云盘同步的纯文件存储。

## 功能

- **论文库**：选择任意目录（iCloud Drive / Dropbox / 坚果云等），拖入 PDF；标题/作者/年份/DOI
  自动识别，可选 Crossref 补全；状态、标签、评分、搜索、BibTeX、重复检测。
- **内置阅读器**：pdf.js 连续滚动、文本层选择、高亮 / 划线 / 备注 / 提问，批注抽屉、点击定位、
  Cmd/Ctrl+Z 撤销、页码跳转与缩放。
- **面板内 AI 精读**：总结、方法精读、批判性审阅、相关工作、提问都在侧栏流式运行，可停止、
  保存到笔记、点引用页码跳转；每条回答可一键生成**笔记卡片**（标题/正文/标签/页码），插入笔记。
- **多篇论文对比**：选 2–6 篇 → 元数据矩阵 + AI 对比报告（对比表、横向结论、建议关联、读过的页），
  报告可保存到 `comparisons/` 并随时回看/删除/重新生成。
- **论文关系图谱**：6 种带类型的边（引用/相关/方法/对比/同主题/自定义），力导向布局、拖拽缩放、
  并行边分叉、点击编辑类型/标签/备注。关系有三个来源：手动添加、AI 发现（候选需确认）、
  从 PDF 参考文献自动补全 `cites`（可设置导入后自动执行）。
- **Agent 工具**：12 个 `paper_*` 工具（列表/搜索/信息/正文/标注/卡片/关系/笔记读写/入库/更新/同步）。
- **同步与安全**：纯文件存储，原子写；外部改动扫描、冲突副本、iCloud 占位文件下载；
  中文 / English 双语界面；所有 UI 使用宿主主题 token。

## 安装

要求 DeepSeek Harness 0.2.1-rc.2 及以上（0.2.x），Node.js 20+。

```sh
# 从 npm（包名带 scope：npm 与已有包 dsh-paperdesk 名称相近）
dsh plugin --profile web add @zhe_xuan/dsh-paper-desk

# 或直接用本 Release 的预构建包（内容与 npm 包一致）
dsh plugin --profile web add https://github.com/ZhexuanZhou/dsh-paper-desk/releases/download/v0.3.0/dsh-paper-desk-0.3.0.tgz
```

桌面版：设置 → 插件 → 搜索 `@zhe_xuan/dsh-paper-desk` 安装；刷新页面后左侧栏出现 **PaperDesk Library**。
首次打开在面板里选择论文库目录（默认 `~/Documents/PaperDesk`）。

## 示例数据

Release 附带 `paperdesk-demo-library.zip`：4 篇合成论文、5 条手写关系 + 6 条自动解析的 `cites` 边，
解压后把「设置 → 库路径」指向它即可体验图谱、AI 发现和引用补全。仓库里也有可复现的
`demo/library/`（`node scripts/make-demo-library.mjs --out <dir> --force`）。

## 文档

- 使用说明与截图：README
- 架构与契约：`DESIGN.md`、`DESIGN-VIEWER.md`、`DESIGN-AI.md`、`DESIGN-FEATURES.md`、`DESIGN-FEATURES2.md`
- 发布到 npm/市场：`docs/PUBLISHING.md`

## 已知边界

- 示例库是合成论文，仅用于演示。
- 引用补全依赖 PDF 里有可提取的参考文献文本；只能匹配库内已有论文，首次扫描会抽取文本，可能较慢。
- AI 对比/发现会读关键页而非全文；结论页引用以模型实际读到的页为准。
