# v0.3.14

- 新增「链接导入」：支持 arXiv 摘要/PDF 链接、直接 PDF URL（含 OpenReview 这类 /pdf 链接），自动下载 PDF、识别元数据并去重
- 下载前校验公网 DNS、重定向、80/443 端口、80MB 上限与 PDF 文件头，拒绝内网地址和 HTML 页面
- DOI 落地页通常不是 PDF，会提示改用 arXiv 链接或 PDF 直链
- 导入成功后自动刷新列表并打开新论文

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
