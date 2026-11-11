# v0.3.32

- 修复保存卡片时「card context text is empty or too long」错误
- 卡片上下文单轮上限提高到 8000 字符，超长内容自动截断而不是拒绝保存
- 保存卡片时默认上下文只包含当前回答之前的对话，不再把正文再复制进上下文
- 新增 smoke 检查：超长上下文会被截断后正常保存

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
