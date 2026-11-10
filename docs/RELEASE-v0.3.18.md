# v0.3.18

- 修复低清预览升级到完整分辨率时清空画布造成的白闪：完整页先画到离屏 canvas，完成后再整体替换
- 逐页阅读时提前 20ms 预热下一页/上一页，并保护当前页前后 3 页不被释放
- PDF 页面 DOM 虚拟化 + 低清首帧继续生效
- 页跳转保持瞬时定位，页码准确

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
