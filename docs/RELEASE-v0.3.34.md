# v0.3.34

- 修复笔记预览中「要点 / 疑问」等二级标题被上一节列表吞掉、越缩越深的问题
- 笔记预览改为按顶层 `##` 分节渲染，避免 Markdown 列表延续到下一个标题
- 代码块中的标题不会被误切分

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
