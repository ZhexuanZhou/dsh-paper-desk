# v0.3.20

- 滚动过程中 PDF 页面按 1x DPR 光栅化，滚动停止 220ms 后自动升级回 2x
- 降低滚动时 canvas 像素量与主线程压力，逐页阅读更流畅
- 升级仍使用离屏 canvas 替换，不产生白屏
- 页面 DOM 虚拟化、低清预览、相邻页低清预取继续生效

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
