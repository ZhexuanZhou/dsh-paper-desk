# v0.4.2

- 笔记采用用户选定的整页方案：左侧分节大纲，中间 Markdown 全文，右侧真实 PDF 首页与已有引用页码。默认阅读预览，进入编辑后保留 400ms 自动保存、Cmd/Ctrl+S、哈希冲突保护和未保存拦截。只切换视图不修改笔记文件。
- 卡片有独立入口，显示完整 Markdown 正文。增加文字大小、行距与卡片间距；保留编辑、插入笔记、复制、删除与合并。每个页码按钮跳转到自己标注的 PDF 页。
- 文献发现可手动选择 arXiv 或 OpenAlex，并明确显示检索来源。arXiv 失败后提供“改用 OpenAlex 检索”，不会静默换源。arXiv 按最新提交排序，OpenAlex 按相关度排序，每次最多 20 项。
- 订阅新增可选 provider 字段；缺失时按 arXiv 处理，schemaVersion 仍为 1。同一检索词可分别订阅两个来源。切换备用源不会推进原订阅的已读时间。
- OpenAlex 结果按 arXiv ID 或 DOI 识别库内论文，同名仍只是候选提示。优先使用确认过的 arXiv PDF 地址；否则使用来源提供的 HTTPS PDF，并沿用导入校验。没有可用 PDF 时禁用入库，保留外部论文链接。
- 每个来源独立串行请求，以响应结束为起点留出间隔（arXiv 3.1 秒、OpenAlex 1 秒）；相同在途检索合并。成功响应缓存 15 分钟并保留原始获取时间。429/503 遵守 Retry-After；无有效头时冷却 60 秒，无自动重试。该修复减少本地重复请求，不承诺修复 arXiv 上游限流。

隐私：检索词只发送给用户选择的来源；本地论文全文和笔记不会用于检索请求。论文、笔记、卡片的磁盘格式保持兼容，笔记排版不改写已有文本。

验证命令：`npm run typecheck`、`npm run build`、`npm run test:regression`、`npm run smoke`。本次通过 67 项回归检查与 33 项冒烟检查。真实产品的局部验收和原始证据保存在 `.acceptances/standalone-paperdesk-redesign/` 后续轮次（不随仓库发布）。

设计参考：`docs/design/notes-fullpage-reference.png`。选择此方案是为了给长笔记和卡片足够的阅读宽度；未采用继续在侧栏叠加卡片的方案。
