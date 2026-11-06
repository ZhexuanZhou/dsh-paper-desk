# PaperDesk · 论文库插件（dsh-paper-desk）

一个把「普通目录」变成 Mendeley 式论文库的 DeepSeek Harness 插件：左边栏一个「论文库」图标，打开就是原生工作台 —— 导入 PDF、自动补全元数据、记笔记与高亮、一键让 Agent 精读论文；整个论文库就是一堆普通文件，放进 iCloud / Dropbox / 坚果云等网盘目录即可多设备同步。

> 已安装在当前 `desktop` profile 中（Plugin Manager 里显示为 **论文库 PaperDesk**）。首次使用见「快速开始」。

![论文库面板](docs/screenshots/library.png)

![PDF 高亮与批注栏](docs/screenshots/annotations.png)

## 功能

| 能力 | 说明 |
| --- | --- |
| 论文库 | 你指定一个目录作为库根；每篇论文一个目录，含 `paper.pdf`、`meta.json`、`notes.md`、文本缓存。 |
| 导入 PDF | 拖拽到面板、点「导入 PDF」、把文件丢进库根的 `_inbox/` 后点「扫描收件箱」，或让 Agent 用 `paper_add` 按绝对路径导入。 |
| 元数据 | 从 PDF 内嵌信息 / XMP / 首页文本 / 文件名推断标题、作者、年份、DOI、arXiv 编号、摘要；有 DOI 时用 Crossref 补全（可关）。同一 PDF 自动去重。 |
| 阅读 | 内置 pdf.js 阅读器（连续滚动、缩放、按页跳转、可选中文本）+ 已抽取文本视图，扫描版 PDF 会提示「可提取文本很少」。 |
| PDF 批注 | 选中文字即可 **高亮 / 划线 / 备注 / 提问**；右侧「批注」栏按页列出所有标注，可编辑批注、删除、或在标注上直接「问 Agent」。标注存于 `annotations.json`，随论文库同步。 |
| 笔记 | 每篇论文一份 Markdown 笔记，固定分区：摘要 / 要点 / 疑问 / 引用 / 我的想法 / 对话与补充。支持 Cmd/Ctrl+S、未保存拦截、按页码追加引用。 |
| Agent 精读 | 读者页右侧 **AI 解读侧栏**：总结 / 方法精读 / 批判性审阅 / 相关工作 / 提问都在面板内流式运行，不跳转会话；可追问、停止、保存到笔记、点引用页码跳转。 |
| Agent 工具 | `paper_list`、`paper_search`、`paper_info`、`paper_text`、`paper_annotations`、`paper_notes_read`、`paper_note_append`、`paper_add`、`paper_update`、`paper_sync`，任何会话都能读写论文库。 |
| 网盘同步 | 文件即状态，无需数据库；面板「同步」页显示网盘类型、外部变更、冲突副本、iCloud 未下载文件，可一键重新扫描 / 解决冲突 / 触发下载。 |
| 管理与导出 | 阅读状态（未读/在读/已读/归档）、星级、标签、在 Finder 中显示、BibTeX 导出、删除进回收站。 |
| 本地化 | 中英双语界面，跟随设置里的语言开关。 |

## 快速开始

1. 点左侧栏的 **论文库图标**（在插件/日程图标一组里）打开面板。
2. 首次打开会显示设置卡片：
   - 选 **「选择目录」**：系统目录选择器里选一个目录。**推荐选网盘目录**，例如：
     - iCloud Drive：`~/Library/Mobile Documents/com~apple~CloudDocs/Papers`
     - Dropbox：`~/Dropbox/Papers`
     - 坚果云：`~/Nutstore Files/Papers`
     - 任意本地目录：`~/Documents/PaperDesk`
   - 或点 **「默认目录」** 使用 `~/Documents/PaperDesk`（之后可随时在设置里更换）。
3. 点「导入 PDF」或把 PDF 拖进面板，等元数据补全后即可开始阅读、记笔记、叫 Agent 精读。

> 之后可以在面板右上角「设置」里更换目录、切换语言、开关 Crossref 补全、扫描收件箱。

## 在 PDF 上做笔记

在「阅读」页选中任意文字，会浮出工具栏：

- **高亮** / **划线**：给选区上色，颜色可在批注栏改；
- **备注**：添加一段批注；
- **提问**：写下问题，PaperDesk 会把「原文 + 你的问题」作为一条提问保存到批注栏，并同时新建会话让 Agent 回答；
- **复制**：复制选中文字。

右侧「批注」栏按页列出所有标注：**点页面上的高亮/划线会自动打开批注栏**并定位到对应条目，可内联编辑批注、删除、或「问 Agent」。快捷键：`⌘Z / Ctrl+Z` 撤销上一步标注操作（新建/删除/修改都能撤销），`Delete / Backspace` 删除当前选中的标注，`Esc` 关闭批注栏。所有标注存进 `annotations.json`，随论文库一起网盘同步，Agent 也能通过 `paper_annotations` 读到。

## 在面板里和 Agent 一起读

阅读器右上角的 **「AI 解读」** 打开右侧 AI 侧栏（和 PDF 并排，面板不变、不跳会话）：

![面板内 AI 解读](docs/screenshots/ai-panel.png)

- 顶部一排任务：**总结 / 方法精读 / 审阅 / 相关工作 / 提问**。点一下，答案就在侧栏里流式出现；工具调用（读了哪几页、查了什么）以一行小字展示，推理过程可折叠。
- 底部可以**继续追问**（同一个会话，上下文连续）；运行中可**停止**。
- 答案里的页码引用会自动汇总成 `p.8 p.31 …` 芯片，点击直接跳到对应 PDF 页；**保存到笔记** 会把整段回答追加到论文笔记（摘要区），**复制** 复制全文。
- 需要完整会话界面时，点 **「在完整会话中继续」** 才会打开宿主会话（唯一的跳转入口）。
- 每篇论文对应一个隐藏的 AI 会话（标题 `AI · 论文名`），刷新/换论文后自动重新挂载并保留对话；会话仍属于论文库工作区。

选中的文字点 **提问**，会把「原文 + 你的问题」保存成提问批注，并在同一个 AI 侧栏里让 Agent 回答。

也可以在任意会话里直接说：「帮我总结论文库里那篇 Drifting 论文」，Agent 会自动搜索并读取。

工具一览（模型可调用）：

| 工具 | 用途 |
| --- | --- |
| `paper_list` | 按状态/标签列出论文 |
| `paper_search` | 跨标题/作者/标签/摘要/笔记/正文搜索 |
| `paper_info` | 单篇元数据 + 笔记状态 |
| `paper_text` | 按页读抽取文本（首次抽取会缓存） |
| `paper_annotations` | 读取你在 PDF 上做的高亮/划线/备注/提问（含页码、原文、批注） |
| `paper_notes_read` / `paper_note_append` | 读笔记 / 追加笔记（冲突安全） |
| `paper_add` | 用本机绝对路径导入 PDF |
| `paper_update` | 改元数据、标签、状态、评分 |
| `paper_sync` | 网盘同步健康度、外部变更、冲突 |

## 目录结构与同步原理

```
<论文库根>/
  papers/
    <paper-id>/
      paper.pdf        # 原始 PDF
      meta.json        # 元数据（含标签、状态、评分、sha256）
      notes.md         # 你的笔记（Markdown，固定分区）
      annotations.json # PDF 高亮/划线/备注/提问（页码 + 原文 + 批注）
      text.json        # 抽取文本缓存（可删，会重建）
  _inbox/            # 把 PDF 丢这里，点「扫描收件箱」自动导入
  .paperdesk/
    scan.json        # 文件指纹快照，用于发现其他设备/外部程序的改动
    conflicts/       # 冲突副本（永不覆盖你的原文）
    trash/           # 删除的论文（移动而非删除）
    cache/           # 临时导入暂存（可删）
```

* **所有内容都是普通文件**，因此任何网盘客户端都能同步；插件不写数据库、不写绝对路径索引。
* **冲突策略**：保存笔记时带上「读取时的内容哈希」。若文件已被其他设备/程序改过，本次保存不会覆盖，而是把内容写到 `.paperdesk/conflicts/` 并在界面提示。可在「同步」页选择「使用这个副本」或「丢弃副本」。
* **外部变更**：`scan.json` 记录每个文件的大小/修改时间。「同步」页显示「自上次扫描以来」其他设备新增/修改/删除的文件；点「重新扫描」建立新基线。
* **iCloud 占位文件**：文件被 iCloud 优化掉时显示「未下载」，可点按钮触发 `brctl download`（仅 macOS）。
* **多设备建议**：同一篇论文的笔记尽量避免两台设备同时编辑；网盘自身的冲突副本（如 `notes (conflicted copy).md`）也能在「同步」页看到。

## 设置

两种入口：面板里的「设置」页（推荐），或 profile 的 `cordis.patch.yml`（插件配置层）。运行时设置保存在 `~/.dsh/paper-desk/settings.json`，优先级 **settings.json > 插件 config > 环境变量**。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `libraryPath` | `''`（未配置） | 论文库根目录的绝对路径；也支持 `~/...`。 |
| `language` | `zh` | 界面与笔记分区语言（`zh` / `en`）。 |
| `enrich` | `true` | 导入/更新元数据时允许调用 Crossref（仅发送标题/DOI）。 |
| `autoImportInbox` | `true` | 保留给收件箱流程的开关。 |
| `maxPdfBytes` | `0` | 上传大小上限（字节），`0` = 不限制（默认）。上传流式写盘，不会因大文件占满内存。 |

环境变量 `DSH_PAPER_DESK_LIBRARY` 可在未配置时作为开发/临时目录回退。

## 数据与隐私

* 论文、笔记、元数据只存在你选择的目录里，不会上传到任何服务。
* 仅在启用 `enrich` 且需要补全元数据时，向 Crossref 发送标题或 DOI（含礼貌性 User-Agent），失败静默回退到本地推断。
* Agent 通过 `paper_*` 工具读取的是本机文件内容，与你在该会话里直接让 Agent 读文件等价。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 左侧栏没有论文库图标 | 确认插件已启用：Plugin Manager → 论文库 PaperDesk；必要时禁用再启用，或刷新页面。 |
| 面板提示「无法连接 PaperDesk 后端」 | Host 端未激活；在 Plugin Manager 里禁用→启用 `paper-desk` 后重试。 |
| PDF 打开是空白 / 提示文件缺失 | 文件可能仍在网盘下载；到「同步」页点下载，或等网盘同步完成。 |
| 高亮/划线没有出现 | 扫描版 PDF 没有文字层，无法选中；请先 OCR 再导入。 |
| 「AI 解读」没出内容 | 侧栏状态会显示「正在连接会话…」或错误原因；重试或刷新页面。Agent 回答需要几十秒，期间可继续看 PDF。 |
| 搜索不到正文 | 这篇 PDF 还没抽取文本：打开它的「文本」页触发一次抽取；扫描版 PDF 无法抽取（可 OCR 后重新导入）。 |
| 保存笔记弹出冲突 | 说明磁盘上的笔记在别处被改过；选择「使用我的版本」会覆盖，或「加载磁盘版本」后合并。 |
| 元数据不准 | 「信息」页里手动改，或点「更新元数据」用 Crossref 重新补全（只填空字段）。 |

## 开发

```bash
cd /Users/zhexuansoffice/Developments/dsh_plugins/dsh-paper-desk
pnpm install          # 首次
pnpm run typecheck    # Host + 浏览器两套 TS
pnpm run build        # tsc -> lib/ + esbuild -> lib/client.js
node scripts/smoke.mjs [可选真实PDF路径]   # 28 项领域冒烟测试
```

安装到 profile：在 Harness 里用 `plugin_manager` 的 `install_bundle`，目标为本目录的绝对路径。Host 端代码改动需要禁用/启用插件行来重新加载模块；浏览器端改动需要刷新页面（除非同时跑着 `pnpm run dev:web`）。

目录：`src/`（Host：目录/笔记/PDF/元数据/同步/HTTP/工具/提示词）、`client/`（React 面板）、`scripts/`（构建与冒烟）、`DESIGN.md`（模块与 API 契约）。

---

## English summary

PaperDesk is a Mendeley-style paper library for DeepSeek Harness. Pick a directory (ideally inside iCloud Drive / Dropbox / Nutstore), then drag PDFs in: metadata is inferred and optionally enriched from Crossref, each paper gets a Markdown notes file with fixed sections, the built-in reader shows the PDF and extracted text, and one click hands the paper to the agent (summary / method / critique / related work / study questions) with a prepared prompt. Nine `paper_*` tools let any session list, search, read and annotate papers. Everything is plain files under your chosen root, so any cloud drive syncs it; writes are hash-guarded and conflicting edits become conflict copies instead of overwrites, with a Sync page for external changes, conflicts and iCloud placeholders.
