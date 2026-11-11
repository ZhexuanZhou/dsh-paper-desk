# v0.3.44

- 修复恢复阅读页后点击上一页/下一页会被 focusPage 重新拉回起始页的问题
- focusPage 只在进入论文或点击批注跳转时应用，不再随虚拟页面窗口变化重复执行
- 上一页/下一页按钮改用 currentPageRef，连续快速点击不再使用过期页码
- 保留 v0.3.43 的 pdf.js renderer worker（实测 longtask 0）与全部阅读/笔记/文献库功能

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
