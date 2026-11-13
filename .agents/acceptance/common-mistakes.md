# PaperDesk 验收经验

## 2026-11-13：真实宿主LLM协议

依据实际DeepSeek Harness适配器源码确认：消息content必须采用canonical block数组，例如`[{type: 'text', text: prompt}]`，不能用字符串。宿主内部会调用content.some/flatMap；仅用接受字符串的测试stub会漏掉协议不兼容。

LLM流的`finish.reason`可能为error或aborted，不能把它们当正常结束，也不能采纳此前收到的partial JSON。测试替身必须模拟真实消息结构、错误事件与终止事件。

真实上传曾在provider调用前失败；修正协议后实际deepseek-official/deepseek-flash完成自动三字段补全。报告必须区分协议失败、模型调用成功与输出内容质量。

## 表单基线与恢复

补全成功后要同步表单与服务端baseline。以新meta直接计算旧表单dirty，会把系统更新误判成用户编辑，甚至让保存覆盖新字段。三方合并应区分用户修改和服务端修改；真实同次补全后检查保存按钮是否禁用。

恢复论文ID时先恢复再默认选首篇。失效ID应安全回退，避免继续加载其批注/对话/卡片导致重复404；临时网络失败不能清掉用户记忆。

私密日志、凭据、原PDF和用户内容截图只留本地验收目录，不提交到项目。
