# v0.3.43

提升 PDF 阅读性能、阅读交互与笔记自动保存：

## PDF 渲染（P0）
- 启用 pdf.js 6.5 的 renderer worker：页面栅格化在主线程之外完成，主线程只 drawImage
- 实测 TRIO 18 页、DPR2、7 次跳页：main 模式 1 个 64ms longtask；worker 模式 longtask 0、主线程 fillText 0
- 滚动条拖动/松手不再触发文字测量和页面绘制卡顿
- 可通过 `?pdfRenderer=worker|main` 或 `localStorage['paperdesk:pdf-renderer']` 回退到主线程

## PDF 阅读交互
- 目录/书签抽屉（带当前页高亮、折叠）
- Ctrl/Cmd+F 全文查找：命中数、上下条、text-layer 高亮
- PDF 链接层：内部跳页，外部仅 http/https 新窗口打开
- 手型工具 + 空格拖动
- 深色纸张模式（偏好持久化）
- 划词菜单：5 种高亮色、复制、批注、提问、加入 AI 对话

## 文献库
- 列表/表格视图切换（localStorage 记忆），表格列：标题/作者/年份/标签、标题/年份排序
- 标签按名称 hash 生成稳定浅色 chip，不写回数据

## 笔记
- 400ms debounce 自动保存，写入串行化；显式保存、冲突处理、切论文确认保留

## Agent 工具
- paper_list/search/annotations/cards/relations 增加 truncated 标记，notes 读取增加字符上限与截断提示

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
