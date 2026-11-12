# PaperDesk 0.4.0 设计验收

**final result: passed**

## PaperDesk 0.4.1 局部界面复核

**final result: passed**

本轮仅复核 0.4.1 的四项界面修正：文献发现空态与关键词订阅、新建/已保存专题界面、AI回答保存菜单、研究数据加载错误与恢复。构建身份为 `lib/client.js` SHA256 `27df3034092d217b953633d4730ff5924777f6971209bcf58ec7b47c20e972a4`。没有重跑模型或改变真实论文库。

对照用户提供的三张问题截图：`assets/before/discover-not-found.png`、`assets/before/research-not-found.png`、`assets/before/ai-save-menu.png`（均在 `.acceptances/standalone-paperdesk-redesign/20261112-followup-0.4.1/`）。对应最终图为 `assets/after/discover-empty.jpg`、`research-create.jpg`、`ai-save-menu.jpg` 和 `research-load-error.jpg`；共享错误恢复见 `discover-load-error.jpg`、`research-load-recovered.jpg`、`discover-subscribed.jpg`。所有最终图均为实际 PaperDesk 插件的 CUA JPEG 原始字节。截图目录与文件名按插件实际内容核对，没有将文字说明当作截图证据。

三张最终主界面截图均为 1701×969；before 截图分别为 1567×651、1320×813、463×894。已在本轮直接查看 before 与 after 的对应界面，并按组件结果对照，不是相同像素视口或完全相同的论文/回答内容；因此只比较状态说明、控件组织、可读性和裁切，不作像素级差异结论。CUA图像没有提供浏览器CSS视口/DPR。AI菜单文字字号和对比度在最终截图中清楚可读；本轮未新增图像资产，已有界面图标和内容没有明显裁切。

| 检查面 | 结论 |
|---|---|
| 文案与内容 | 初始文献发现给出检索和空订阅说明；输入关键词后出现针对当前检索的订阅操作。新专题按问题、论文选择、保存顺序引导；错误页明确提示未修改专题、订阅或论文，并给出重新加载入口。原始 `not-found` 不再直接显示。 |
| 间距与布局 | 研究新建阶段移除了不可用的讨论栏，问题/论文输入与保存提示保持在主区域。文献发现订阅操作紧邻查询，窄侧栏中的回答保存菜单不裁切，两项动作在统一菜单内可见。 |
| 颜色与视觉层级 | 页面沿用低饱和暖白背景、浅色面板和低饱和强调色；错误卡片和次级操作有清楚层级。没有为了贴合旧截图复制原始错误样式。 |
| 状态与恢复 | 隔离 `research.json` 解析失败时，两页显示一致的友好加载错误；还原文件后分别通过“重新加载”恢复专题/订阅内容。未捕获HTTP状态；404专用宿主重载指引未在本轮真实UI触发。 |

AI单一“保存”菜单可打开原卡片编辑器；取消后没有生成 `cards.json`。本轮没有记录笔记文件写入前哈希，因此只确认取消没有创建卡片，不据此判断笔记文件未变化。一次 arXiv 查询返回真实429错误，界面清楚提示限流和重试；没有重复请求。以上边界不构成发现或保存菜单的 P0/P1/P2 视觉问题。最终局部复核没有发现剩余 P0、P1 或 P2。

## 范围与证据

本次只复核最终 UI 媒体和上轮三项视觉修复，没有重新执行功能或模型验收。实现身份为 PaperDesk 0.4.0；验收记录的构建文件 `lib/client.js` SHA256 为 `9282f2a90ff197a7fa7c915183dffa0e3ce08e9978ae2c0b79eadc40271f68e0`。

- 设计参考：`.acceptances/standalone-paperdesk-redesign/20261112-030500-pre-change/assets/ui-reference.png`（1716×911）
- 最终原始截图：`.acceptances/standalone-paperdesk-redesign/20261112-030500-pre-change/assets/final-reader-collapsed-cua.jpg`（1701×969；SHA256 `fac2193a978f034d7e3188bb3df7c1730fdf38da0bc633661cb169311e634fcb`）
- 插件内容裁图：`.acceptances/standalone-paperdesk-redesign/20261112-030500-pre-change/assets/final-reader-plugin-crop.jpg`（1646×969；SHA256 `e4e8c070d78237219225dc3cb60efcd75bfd1cb016bb2d235b389da64c4df182`）
- 局部复核图：`assets/focus-header-source.png`、`assets/focus-header-implementation.jpg`、`assets/focus-ai-source.png`、`assets/focus-ai-implementation.jpg`，均位于上述验收目录。

截图状态为隔离验收资料库中的 TRIO，第 6 页，论文列表和 DSH 宿主侧栏收起，右侧 AI 助读面板打开。面板显示已有问题“请用一句话概括这篇论文的核心方法。”及历史回答，没有发起新模型请求。原始截图中宿主侧栏占 55px；比较使用裁去宿主栏、宽 1646px 的插件图。参考图按宽度等比缩放至 1646px（高度约 874px），实现图保持原始像素尺寸。CUA 截图接口不提供 CSS viewport 或 devicePixelRatio，因此无法报告这两项；高度和纵向内容密度按截图像素比较。

参考图是设计意图图，不是同一篇论文的内容截图：参考图展示 TRIO 的方法页及另一条助读问题，实际界面显示第 6 页的结果表和历史摘要回答。因此本次比较界面结构、排版和视觉风格，不把论文内容差异作为 UI 缺陷。DSH 宿主栏属于容器界面，已从插件比较中裁去。

## 五项视觉检查

| 检查面 | 结论 |
|---|---|
| 字体与排版 | 正文、标题层级清楚。AI 回答字号和行高已提高，长段落及分点阅读顺畅；没有观察到字形缺失或文字截断。未据截图推断具体字体名称。 |
| 间距与布局 | PDF 仍是主内容区，右侧助读/批注/笔记分区明确，底部追问区与回答区分开。顶部文档信息、PDF/Text/Notes/Info 切换和 PDF 工具栏比参考图多一行控件，PDF 起始位置略低；这些是实际功能标签，当前没有挤压 PDF 阅读区或遮挡内容，不构成可操作的 P2 问题。 |
| 颜色与视觉 token | 暖白底色、低饱和绿色强调和浅色辅助面板已接近参考图。对比度足以区分选中状态、标签、正文和次级操作。 |
| 图像质量 | PDF 页面和表格在截图中清晰，滚动条、面板边缘和控件无明显缩放模糊、裁切或重叠。 |
| 文案与内容 | “助读”“批注”“笔记”等标签简洁一致；AI 历史问题和回答可读。实际论文页与参考图不同，按前述范围处理。 |

## 修复沿革与最终结论

初轮媒体检查记录了三项 P2：顶部控件区偏高、背景白色偏冷、AI 回答字号偏小且行距偏紧。最终构建压缩了顶部控件高度，改为暖白背景，并调整 AI 正文字号、行高和标题/段落间距。对最终截图及对应局部裁图复核后，三项问题均已消除；没有发现剩余 P0、P1 或 P2。顶部相较参考图仍多一行产品操作标签，但它们承担实际切换功能，当前视口下 PDF 主区和助读内容均完整可读，记录为设计差异，不阻止通过。

**final result: passed**
