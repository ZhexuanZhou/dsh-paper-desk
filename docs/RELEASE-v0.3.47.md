# v0.3.47

- PDF 滚动条拖动恢复实时跟随：滑块移动时页面同步滚动，不再松手后才跳
- 保留拖动期间延迟页窗口/当前页更新，实测拖动期间 longtask 0
- 冷页 TextLayer 合并同 line item 并跳过 measureText（v0.3.46）：第 5 页首次翻入约 150ms
- 页面栅格 DPR 上限 1，renderer worker 保持

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
