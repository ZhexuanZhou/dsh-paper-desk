# PaperDesk 验收经验

## 2026-11-13：真实宿主LLM协议

依据实际DeepSeek Harness适配器源码确认：消息content必须采用canonical block数组，例如`[{type: 'text', text: prompt}]`，不能用字符串。宿主内部会调用content.some/flatMap；仅用接受字符串的测试stub会漏掉协议不兼容。

LLM流的`finish.reason`可能为error或aborted，不能把它们当正常结束，也不能采纳此前收到的partial JSON。测试替身必须模拟真实消息结构、错误事件与终止事件。

真实上传曾在provider调用前失败；修正协议后实际deepseek-official/deepseek-flash完成自动三字段补全。报告必须区分协议失败、模型调用成功与输出内容质量。

## 表单基线与恢复

补全成功后要同步表单与服务端baseline。以新meta直接计算旧表单dirty，会把系统更新误判成用户编辑，甚至让保存覆盖新字段。三方合并应区分用户修改和服务端修改；真实同次补全后检查保存按钮是否禁用。

恢复论文ID时先恢复再默认选首篇。失效ID应安全回退，避免继续加载其批注/对话/卡片导致重复404；临时网络失败不能清掉用户记忆。

私密日志、凭据、原PDF和用户内容截图只留本地验收目录，不提交到项目。


## PDF文字层语言与真实选区（0.4.5）

仅保留PDF item.width仍不足：实际MiTA中pdfjs测量canvas.lang为空串，而文字层继承宿主zh-CN，导致sans-serif的Latin度量不同。DOM实测首行481.61px，修复语言一致后432.801px。TextLayer需与pdfjs canvas使用相同content.lang（缺失显式空串阻断继承），并用真实Range/鼠标选区检查跨字体、部分span端点；不能只靠几何单测。旧注记颜色应整组统一透明度，避免父子rect重叠加深。用户删除的记录不可为验收恢复真实库；历史真实读取转录必须注明provenance且只在隔离库重放。


## 0.4.6 助读响应式与验收冻结

小屏overlay不能继承PDF read-shell的320px高度；真实600px检查发现composer挤占后回答只剩约35px。应给overlay独立viewport高度并亲检回答可读空间。变更验收期间build/watch会自动将插件返回Harness壳；源码和bundle需冻结到runner完成，失败locator后先fresh确认自己页面，不能据此误称用户切走。多字段草稿/附件状态用函数式更新，复测移除附件后编辑草稿不应写回旧附件。真实图片问答证据需同时检查session中的image block与实际provider/model，不能只以模型说看过图为证明。


## 0.4.7 构建产物必须与源码语义一致

源码直接render正确不能代表发布bundle正确。真实DOM显示H2被多层LI包裹并累计120px缩进，而源码Marked无此嵌套。根因是build-client对完整esbuild输出逐行加缩进，改写模板字符串中换行，使Marked内部join/split规则变成换行加制表符。嵌入bundle必须保留code字节语义，并用实际lib factory与源码对同一真实原稿比较。数学应交给Marked扩展，避免全局占位替换破坏代码/列表；比较运算符和代码内美元符需同时验证。MathML accent几何略超本体可由外层padding容纳，普通inline本体不应自带overflowauto滚动条；长公式滚动放外层并验证后续正文位置。
