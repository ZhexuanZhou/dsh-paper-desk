# v0.3.25

- 新导入的论文会根据标题、摘要、关键词自动生成 3–5 个主题标签
- 覆盖 PDF 拖入、链接导入、_inbox 扫描、paper_add 等所有 createPaper 路径
- 使用本地确定性规则，不联网、不调用 LLM；同一篇论文重复导入不会产生不同标签
- 显式传入的标签优先，不会被自动标签覆盖
- 没有摘要的论文不会生成标签，避免臆测

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
