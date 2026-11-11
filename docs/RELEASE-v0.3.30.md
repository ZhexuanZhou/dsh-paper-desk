# v0.3.30

- 修复 AI 侧栏窄宽下 Markdown 表格被压扁的问题：表格改为内容宽度并支持横向滚动
- 表格单元格设置最小宽度，数字使用等宽数字排版
- 行内/独立公式支持横向滚动，避免长公式把正文挤成多行
- 这是 Markdown/KaTeX 渲染层问题，与 PDF 原排版无关

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
