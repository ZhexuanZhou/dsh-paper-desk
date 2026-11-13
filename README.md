# PaperDesk · 论文管理与 AI 助读

PaperDesk 是 DeepSeek Harness 的论文库插件。导入 PDF，在同一工作台阅读、批注、提问和整理笔记，再围绕研究专题比较与发现文献。

论文库直接保存在你选择的目录中：PDF、Markdown 笔记和 JSON 元数据都是普通文件，可以交给自己的网盘客户端同步。

**当前源码版本：0.4.7** · [本版更新说明](docs/RELEASE-v0.4.7.md) · [安装与发布说明](docs/PUBLISHING.md)

## 功能概览

| 能力 | 说明 |
| --- | --- |
| 论文导入 | 上传、拖拽、链接导入、扫描 `_inbox/`，或通过 `paper_add` 按路径导入；相同 PDF 自动去重。 |
| 元数据 | 提取标题、作者、年份、DOI 等信息；可用 Crossref 补全，并用当前配置的模型补齐空的摘要、关键词和标签。 |
| PDF 阅读 | 连续滚动、缩放、旋转、目录、全文查找、页内与外部链接、手型拖动和深色纸张。 |
| 高亮与批注 | 选中文字后高亮、划线、备注或提问；批注按页整理，可编辑、删除或交给 AI 解答。 |
| AI 助读 | 在阅读器旁流式问答，支持独立对话、快捷任务、原页图片附件、引用页核对、回答批注和保存。 |
| 笔记与卡片 | Markdown 整页阅读、分节目录、自动保存；回答可保存为独立卡片，再编辑或插入论文笔记。 |
| 研究专题 | 围绕研究问题关联多篇论文，整理专题笔记并持续讨论。 |
| 文献发现 | 选择 arXiv 或 OpenAlex 搜索，保存检索订阅，手动检查新文献并确认入库。 |
| 对比与图谱 | 对比 2–6 篇论文，保存对比报告；管理引用、相关、方法、对比等论文关系。 |
| 本地管理 | 阅读状态、评分、标签、BibTeX 导出、文件定位、冲突副本和中英文界面。 |

下面的截图用于展示主要功能，部分来自较早版本；当前入口与交互以本文说明为准。

![论文库与阅读器](docs/screenshots/library.png)

![PDF 高亮与批注](docs/screenshots/annotations.png)

## 0.4.7 的主要变化

- **修正 Markdown 层级**：发布包保留构建输出的原始字符串，避免标题被错误嵌入列表，或后续段落不断向右缩进。
- **统一公式渲染**：AI 回答、卡片和笔记共用渲染器；比较符号、行内与独立公式正常排版，代码里的美元符号保留原文，长公式在自身区域内横向滚动。
- **阅读优先的助读界面**：对话管理集中在顶部，回答分别提供复制和保存；提问、任务与图片附件统一放入输入框。
- **正文预览优先的卡片弹窗**：突出标题和正文，可切换编辑；标签、来源页码和上下文按需展开，保存与取消固定在底部。

其他近期改进包括 PDF 链接与高亮定位、导入后的 LLM 空字段补全，以及按论文库恢复上次打开的论文。详细记录见 [0.4.6](docs/RELEASE-v0.4.6.md)、[0.4.5](docs/RELEASE-v0.4.5.md)、[0.4.4](docs/RELEASE-v0.4.4.md) 和 [0.4.0](docs/RELEASE-v0.4.0.md)。

## 安装与快速开始

### 从源码使用当前版本

```sh
git clone https://github.com/ZhexuanZhou/dsh-paper-desk.git
cd dsh-paper-desk
pnpm install
npm run build
```

在 Harness 的插件管理器中从本地目录安装，选择构建后的仓库目录。桌面 profile 由 Harness 应用管理；Host 代码更新后需要在插件管理器中关闭再开启插件，浏览器界面更新后需要刷新页面。

对于命令行维护的 profile，也可以使用：

```sh
dsh plugin --profile <profile> add /path/to/dsh-paper-desk
```

### 从 npm 安装

公开包名为 `@zhe_xuan/dsh-paper-desk`：

```sh
dsh plugin --profile <profile> add @zhe_xuan/dsh-paper-desk
```

Git tag 与 npm 发布是独立操作。从 npm 安装得到的是 registry 已发布版本，未必与当前源码版本相同，可用 `npm view @zhe_xuan/dsh-paper-desk version` 查询。

### 创建论文库

1. 打开侧边栏的 PaperDesk 论文库入口。
2. 在设置中选择论文库目录，也可以使用默认目录。若要多设备同步，可选择自己的网盘目录。
3. 上传或拖入 PDF，等待导入完成后阅读。也可以把文件放入 `<库>/_inbox/`，再扫描收件箱。
4. 在“信息”页核对元数据；空的摘要、关键词或标签可以点击“用 LLM 补全空项”重试补全。

## AI 助读

在阅读器中打开 **AI 助读**，即可一边看 PDF，一边讨论当前论文。

- **提问**：在输入框直接输入问题，点击发送。Enter 发送，Shift+Enter 换行；输入法选词期间 Enter 用于完成选词。
- **快捷任务**：选择总结、方法精读、审阅、相关工作或提问任务，可补充具体要求，再点击发送。选择任务本身不会立即执行。
- **原页图片**：通过输入框的附件入口添加页码，最多 3 个不同页面。附件会显示明确页码，可编辑或逐个移除；翻动 PDF 不会改变已附页码。
- **阅读回答**：支持 Markdown、公式、列表、表格和代码；推理与工具过程可展开查看。生成中可以停止，向上阅读时不会强行跟随滚动，可点击“跳到最新”返回。
- **核对引用**：每条回答独立列出引用页面。点击后查看 PDF 原页或提取文本，再跳回阅读器。页码来自回答中的引用标记，有页码不代表结论已核实。
- **保存结果**：每条完成的回答都有“复制”和一个“保存”菜单，可选择追加到论文笔记，或保存为卡片。
- **回答批注**：选中回答中的文字后写评论；批注默认收起，可展开修改或统一提问。

原页以最长边 2000px 的 JPEG 发送给当前会话模型。普通文字提问不自动附图；选区提问会附上对应原页。图片处理或模型请求失败会提示错误，不静默改成纯文字请求。

### 对话与草稿

每篇论文支持多条独立对话。顶部可切换或新建对话；重命名、删除、回答字号和“在完整会话中继续”位于更多菜单。

- 对话文本保存在 `papers/<id>/chats.json`，随论文库同步。
- 输入框的未发送文字、任务和图片附件按论文及对话保留在本机；请求失败会保留草稿。
- 宿主 session 用于执行模型请求。删除宿主 session 不会删除插件已保存的对话；重新提问时可依据历史记录创建本地执行会话。
- 跨设备可以继续使用同步后的对话文本，但宿主 session 和未发送草稿不随论文库同步。

## PDF 批注、笔记与卡片

### PDF 批注

选中文字后可高亮、划线、备注、提问或复制。点击已有标注可以定位对应批注；右侧按页管理批注。

- `Cmd/Ctrl+Z`：撤销批注操作。
- `Delete/Backspace`：删除当前选中批注。
- `Esc`：关闭批注面板。

批注保存在 `annotations.json`。扫描版 PDF 可能没有可选中文字，插件会提示可提取文本较少；可在外部完成 OCR 后重新导入。

### 论文笔记

“笔记”页默认显示排版后的 Markdown：分节目录用于定位，正文旁可核对引用原页。支持编辑、自动保存和 `Cmd/Ctrl+S`；保存冲突会提示处理，不覆盖其他设备的修改。

### 从回答保存卡片

在回答下方选择 **保存 → 保存为卡片**。已有内容默认显示正文预览，可切换编辑；标题可修改，标签、来源页码和上下文按需展开。

“根据对话生成”是独立操作，会依据所选上下文重新整理标题和正文；直接保存卡片不会额外调用模型。

保存后，在独立“卡片”页按目录阅读全文，或编辑、核对页码、复制、插入笔记和删除。卡片保存在 `cards.json`，不会自动写入论文笔记。

## 研究专题与文献发现

### 研究专题

新建专题按“研究问题 → 参考论文 → 保存”组织。保存后围绕所选论文讨论，专题笔记可以后续补充。

讨论参考所选论文已有的摘要、笔记、卡片和已保存对比；正文通过 `paper_text` 按需读取，节选不等同于全文证据。回答只有明确加入专题笔记并保存后才写入。

### 文献发现

- arXiv 按提交时间排序，OpenAlex 按相关度排序，每次最多返回 20 篇。
- 检索词可保存为带来源的订阅，通过手动刷新检查更新；当前没有后台定时轮询或任意 RSS URL 接入。
- 每个来源独立排队、合并相同在途请求，并缓存成功结果 15 分钟。遇到上游限流时显示冷却状态并遵守 `Retry-After`。
- arXiv 不可用时可以手动选择 OpenAlex，不会自动更换检索来源。
- 论文须确认后才入库。可按 arXiv ID 或 DOI 提示已在库内；同名仅作候选提示，不自动合并。没有可下载 PDF 的结果仍可打开论文链接。

专题和订阅保存在 `<库>/.paperdesk/research.json`，关联现有论文 ID，不复制 PDF。

## 论文对比与关系图谱

勾选 2–6 篇论文进行对比：先看元数据矩阵，再生成 AI 对比报告。报告可保存到 `<库>/comparisons/`，后续重新打开；关系建议需要明确确认后才加入图谱。

图谱支持引用、相关、方法、对比、同主题和自定义关系。可以手动添加和编辑，也可以让 AI 提出候选后确认，或从参考文献中补全库内引用。

设置中的“导入后自动解析参考文献补引用”默认关闭，开启后可在导入时补建库内 `cites` 关系。图谱数据保存在 `.paperdesk/relations.json`；Agent 的关系读取工具不会自动写入关系。

## Agent 工具

在任意宿主会话中，都可以让 Agent 使用论文库工具。

| 工具 | 用途 |
| --- | --- |
| `paper_list` / `paper_search` | 按条件列出论文，或搜索标题、作者、标签、摘要、笔记与已抽取正文。 |
| `paper_info` / `paper_text` | 读取元数据或指定页的正文；首次抽取会缓存文本。 |
| `paper_annotations` / `paper_cards` | 读取批注与笔记卡片。 |
| `paper_relations` | 只读查询论文关系。 |
| `paper_notes_read` / `paper_note_append` | 读笔记或追加内容。 |
| `paper_add` / `paper_update` | 导入本地 PDF，或修改元数据、标签、状态与评分。 |
| `paper_sync` | 检查外部变更、网盘文件状态与冲突。 |

搜索按字面子串匹配，不需要额外包裹引号或使用搜索引擎语法。正文需先通过“文本”页或 `paper_text` 完成抽取，才会进入内容搜索。

## 数据、同步与隐私

```text
<论文库>/
  papers/<id>/
    paper.pdf
    meta.json
    notes.md
    annotations.json
    cards.json
    chats.json
    text.json
  comparisons/
  _inbox/
  .paperdesk/
    research.json
    relations.json
    scan.json
    conflicts/
    trash/
    cache/
```

- 文件同步由你配置的网盘客户端负责。删除的论文先移入回收站，文本缓存可以重建。
- 笔记等内容写入使用哈希检查及冲突副本；跨设备同时编辑同一文件仍应尽量避免。
- 导入时的 LLM 补全会把标题、已有摘要/关键词/标签及前 4 页最多 7000 字符的节选发给配置的模型。已有非空字段保留；模型不可用或结果不足时显示警告，论文仍保存。
- AI 助读会把相关文字、笔记及你明确附上的原页图片交给宿主配置的模型服务。请依据该服务的数据处理规则使用。
- Crossref 补全发送标题或 DOI；文献发现向所选 arXiv 或 OpenAlex 发送检索词，不发送本地论文全文。

## 设置与故障排查

在面板设置中选择库目录、界面语言、Crossref 补全、收件箱扫描及引用补全等选项。也可由命令行 profile 的插件配置提供默认值。

| 配置键 | 默认 | 说明 |
| --- | --- | --- |
| `libraryPath` | 未配置 | 论文库目录，支持 `~/…`。 |
| `language` | `zh` | 中文或英文。 |
| `enrich` | `true` | 允许 Crossref 元数据补全。 |
| `autoImportInbox` | `true` | 为收件箱流程保留的配置项；扫描通过面板触发。 |
| `citationSync` | `false` | 导入后补全库内引用关系。 |
| `maxPdfBytes` | `0` | 上传大小上限；`0` 表示不限制。 |

运行时设置优先于插件配置；`DSH_PAPER_DESK_LIBRARY` 可作为未配置时的库路径回退。默认设置文件位于 `~/.dsh/paper-desk/settings.json`，实际位置随 `DSH_HOME` 而变。

| 现象 | 处理 |
| --- | --- |
| 没有论文库入口或后端无法连接 | 在插件管理器确认已启用；Host 更新后关闭再开启插件，并刷新界面。 |
| PDF 缺失或为空 | 检查库目录、文件是否存在，以及网盘占位文件是否已下载。 |
| AI 没有回应 | 查看侧栏连接或错误状态，可停止、重试，或创建新的对话。 |
| 搜索不到正文 | 打开“文本”页触发抽取；扫描件可先在外部完成 OCR。 |
| 笔记保存冲突 | 重新加载磁盘内容并合并，或明确选择保留自己的版本。 |
| 元数据不准或为空 | 在“信息”页手动修改，或分别使用 Crossref 和“用 LLM 补全空项”。 |

## 示例库与开发

`demo/library/` 包含合成论文与示例关系，用于尝试阅读、关联和引用功能，不是真实研究证据。可以复制到自选目录后作为论文库打开。

```sh
pnpm install
npm run typecheck
npm run build
npm run test:regression
npm run test:markdown
npm run test:ai-composer
npm run test:ui-state
npm run smoke

# 可选：生成独立示例库，避免覆盖现有目录
node scripts/make-demo-library.mjs --out /path/to/demo-library
```

`test:markdown` 同时执行源码与实际发布模块，比较正文、分节预览和目录输出，防止构建产物改变渲染语义。其他专项命令见 `package.json`。

开发目录：`src/` 为 Host，`client/` 为浏览器界面，`scripts/` 为构建及验证；契约文档包括 [DESIGN.md](DESIGN.md)、[DESIGN-AI.md](DESIGN-AI.md)、[DESIGN-VIEWER.md](DESIGN-VIEWER.md) 和 [DESIGN-FEATURES.md](DESIGN-FEATURES.md)。

## English summary

PaperDesk is a paper-management and AI reading plugin for DeepSeek Harness. Import PDFs, read and annotate them beside a persistent per-paper conversation, attach original page images, and save useful answers as notes or cards. Research topics organize multiple papers around a question; discovery supports arXiv and OpenAlex, while comparison reports and a typed relation graph connect the library.

All library content lives in ordinary PDF, Markdown and JSON files under a directory you choose. Your cloud-drive client handles synchronization. AI requests use the host's configured model service; Crossref and discovery requests send the metadata or search terms described above. The source version and npm release version may differ. See [publishing](docs/PUBLISHING.md) for package and distribution details.
