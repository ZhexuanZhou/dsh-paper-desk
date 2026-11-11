# v0.3.45

- 冷页首次完整渲染不再等待 Retina 2x 位图：页面栅格 DPR 上限调整为 1
- 实测 2x 冷页约 5s，1x 冷页约 2s；文字在常见缩放比例下仍清晰
- 保留 pdf.js renderer worker，主线程仍不执行页面绘制
- 修复上一页/下一页回弹到恢复页的问题（v0.3.44）

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
