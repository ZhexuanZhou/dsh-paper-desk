# v0.3.40

- 修复窄窗口下 PDF 滚动条与 AI 抽屉拖动条重叠：抽屉以浮层打开时滚动条自动移到抽屉左侧
- 拖动 PDF 滚动条期间不再逐帧重算页面窗口和重渲染页面，松手后才更新当前页
- 窗口/面板变宽时暂停页面栅格化并隐藏文字层，尺寸稳定后才恢复，减少连续 resize 卡顿
- PDF 页容器增加 layout/paint containment，降低重排范围
- 保留 16px 自定义滚动条、12px 面板拖动条、1x→2x 渐进渲染

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
