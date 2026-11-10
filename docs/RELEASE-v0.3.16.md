# v0.3.16

- PDF 翻页/跳页时先显示页码 + 加载指示，不再是一张纯白页
- 跳页前先启动目标页渲染；空闲时预热上一页/下一页，快速顺序翻页通常直接命中已渲染画布
- 刚离开视口的页面延迟 1.2 秒释放，快速回翻不再重新光栅化
- pdf.js rangeChunkSize 提升到 1MB，减少分块请求
- 超过 80 页的大 PDF 跳过启动时的全页视口扫描，先保证首页可用
- 固定导出路由 `paperdesk file` 支持 Range/ETag（0.3.15）继续生效

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
