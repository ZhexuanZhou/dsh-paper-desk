# v0.3.35

- 拖动论文列表宽度不再每帧更新 React 状态，改为直接写 DOM，松开鼠标才提交一次宽度
- AI 助读抽屉拖动同样改为直接写宽度，避免每帧重渲染 PDF
- ReaderView / LibraryView 做记忆化，搜索输入、toast、列表筛选等全局状态不再重渲染 PDF 阅读器
- AI 流式回答合并到每个动画帧刷新一次，避免每个 token 重新解析整段 Markdown 造成卡顿

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
