# v0.3.26

- 新论文自动标签改为由 Host LLM 基于标题、摘要和前 4 页引言生成 3–5 个主题标签
- 使用当前 DSH 默认模型；模型不可用或返回异常时自动回落到本地主题词表，导入不会失败
- 覆盖 PDF 导入、链接导入、_inbox 扫描与 paper_add
- 左侧论文列表的「收起」按钮改为带文字的明确按钮，双击列表分隔条也可以收起

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
