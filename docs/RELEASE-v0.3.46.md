# v0.3.46

- 冷页卡顿的真正原因定位为 PDF.js TextLayer 的逐 span canvas.measureText（一页可数千次，主线程数秒）
- 合并同一行/同一字体的文本 item，并将 text-layer item width 置 0 以跳过 measureText；文字选择仍可用
- 实测 TRIO 第 5 页首次翻入：从约 5–6s 降到约 150ms，PerformanceObserver longtask 0
- 冷页首批位图 DPR 上限保持 1，renderer worker 保持启用
- 保留 v0.3.44 的上一页/下一页回弹修复

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
