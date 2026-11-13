# 整页笔记设计验收

检查者：acceptance_resume（新增媒体唯一检查者）。修后bundle SHA256 c9692668146684f2ff3f5ba46776a3eaea1e93cb235c804ac533528dd676acac。

参考docs/design/notes-fullpage-reference.png已亲检。after/notes-fullpage.jpg与参考一起人工比较：左大纲、中全文、右真实PDF来源结构一致；正文可读、标题层级清楚、库列表进入后自动折叠。实现沿用真实源note标题和内容，不复制参考图论文论述。

真实TRIO notes与3卡只读克隆到隔离fixture；notes预览前后hash262d87d7ab5a906266e77468cb456b6366a53d42604341d9c3e020cce36b6996一致，说明切预览不改写。新大纲列出全部13个顶层h2。旧仅显示摘要的P2已修；旧证据保留after/notes-fullpage-before-outline-fix.jpg。

编辑与阅读预览切换正常。隔离note加入保存marker后自动写盘，UI已同步7013字符；退出并重新进入仍有marker。未精确测量400ms延迟。真实源note确认无marker。

卡片独立tab显示3张，完整Markdown标题、引用、列表和正文可读；after/cards-fullpage.jpg已亲检。第一卡p.6点击后PDF页字段=6/18，精确跳转通过。

1000×900窄屏after/notes-narrow.jpg已亲检：正文正常换行、大纲可滚动、右PDF来源可见，未见控件覆盖正文；临时viewport已reset。

当前无未解决P0/P1/P2。此记录不替代检索限流异常UI的独立验证。


## 最终冻结版本复核

最终bundle SHA256 b5060706814092e2d80218840c7920883ba01e848373e973a5fc9e5de336745d。最终主图assets/after/notes-reference-viewport.jpg为1487×1058，与参考图相同视口，已亲检三栏、正文、真实PDF、全部大纲与深色选中文字/页码chip。没有P0/P1/P2。前述功能和1000px证据来自c969版本，最后仅两处文字色改变，未重跑未受影响行为。c969同视口图另存notes-reference-viewport-c969.jpg。

限流恢复已由独立API边界注入case完成：5秒冷却禁用/恢复、切OpenAlex真实返回20篇；不将注入称作本次真实上游429。本轮单次真实arXiv查询实际成功。

native已通过插件管理器关闭/开启，刷新后管理器v0.4.2；真实TRIO整页笔记已亲检，6998字符未写入。原生OpenAlex查询返回20篇，首项dKV-Cache 2505.15781，证实后端已更新。最终返回笔记时用户接管，未继续操作。

final result: passed


## 0.4.3 局部设计验收

最终build ba203822393cd8563d2729660ff478383bb9a9fee55615ee101642eaba661a9b。用户最新0.4.2红批注截图与旧cards before均亲检，仅作需求。最终宽屏/1000px版本badge正确为v0.4.3；AX title如实说明界面/后台报告版本。主笔记tab保留、侧栏笔记tab移除；原生已只刷新验证。

三卡目录与完整正文并排，第二/第三点击定位、上滚自动高亮均实测；1000px纵向与600px横向目录可读，零卡空态正常。目录行为证据来自243de3构建，最终仅版本来源与tooltip改变，未受影响证据复用。新增after截图在private验收轮目录，不提交图片。

无未决P0/P1/P2。旧drawer notes偏好未人工注入，不把兼容路径当作单独UI验证结论。未重跑已验OpenAlex/notes原功能。

final result: passed


## 0.4.4 验收

最终client3175258989076183229eb803ccb87cdaa1da718469ce23cebc1d1e2dcfaac8e9，Host importMetadata80240c2ddf27386bf332ce67c74e1f62ba7943a43345f736d0d0e84e24755726。geometry媒体复用04f902，之后几何未改。用户before与TRIO51/100/156% after亲检，热区和文字对齐。标准/裁切UserUnit2四旋转页内循环通过，独立manifest验证记录在private round。工具无hover，未外链点击。

真实UI上传与真实deepseek-official/deepseek-flash补全成功，完整摘要忠于PDF，关键词标签相关；隔离手动补空保留原字段。表单假dirty P2已修，原生同次补全后保存disabled通过。非首篇跨插件与刷新恢复、过期ID安全回退通过。原MiTA仅授权三空项和updatedAt改变，其他字段/PDF/notes未变。

新增媒体由acceptance_resume唯一亲检，无未决P0/P1/P2；不提交private截图/PDF/日志。

final result: passed


## 2026-11-13 · 0.4.5 PDF高亮

final result: passed

来源：用户0.4.4批注截图（红框仅需求标注），与0.4.5真实UI after逐项亲检。构建SHA256 `93131893094b29bf00fcef7ba14859a76be82c647153e66a28fbe15667aebeab`。旧7rect历史记录仅隔离重放，100/51/156%颜色统一、终点止于斜体N，原记录hash不变。真实新三行选区保存4rect；另一段部分span端点保存1rect；刷新80/125%无越界或颜色加深。native v0.4.5临时选择准确，未保存，真实空annotations及PDF/notes哈希不变。before/after视口与缩放不同，比较语义边界，不声称像素一致。

私有证据位于 `.acceptances/standalone-paperdesk-redesign/20261113-followup-0.4.5/`，不提交原PDF/截图。未发现未解决P0/P1/P2。


## 2026-11-13 · 0.4.6 AI助读与卡片弹窗

final result: passed

输入：用户选定第1张AI助读设计（1487×1058）与用户旧助读/卡片弹窗截图；均由验收runner亲检。after同1487×1058，另有1000×900和600×900。原始与并排/focuscrop位于私有round `20261113-followup-0.4.6`，不提交截图。

核对结果：当前对话菜单、新建/更多、回答复制/单一保存、批注折叠、内嵌任务与图片chips具备；1000可读，600初版高度不足已修为inset12全高overlay并复验。卡片整体改为820白纸面、22px标题、16px/1.9正文、默认预览、编辑切换、独立来源和折叠上下文/标签，窄屏固定保存取消可达，实际隔离保存/取消hash检验通过。无未解决P0/P1/P2。

差异与边界：after保留55px宿主收起侧栏，PDF缩放/实际回答与设计示意内容不同。页码引用按现协议在回答尾部分组并标“引用页面”，没有段落级来源映射，不伪造inline引用。字号与内容长度因真实回答不同，不声称像素一致。派生并排及focuscrop仅用于对照，原图保留。

最终client `047d3607da376c83e97c0f90db5f2fd4dab90d5412d743d405afefad2f3f97b6`；早期0109真实模型/管理证据、b6c8卡片与响应式证据未受后续仅空态disabled/aria-pressed变化影响，保留各自provenance。native已刷新确认v0.4.6（后台缓存v0.4.5），未写真实数据。


## 2026-11-13 · 0.4.7 公式与Markdown层级

final result: passed

沿用用户选1的阅读视觉语言，本轮局部修复无需新设计稿。原用户截图、真实0.4.6 before与0.4.7 after（同1701×913）逐项亲检；派生focus对比 `original-before-after.jpg` 保留原截图字节。末节H2从累积120px缩进恢复正文基线，全部标题无LI祖先，列表正常一层；两处s>1为MathML，tildeQ无灰滚动条。人工边界稿在助读/卡片/笔记均真实渲染，代码美元符保留，400px长公式仅自身水平滚动，后续正文基线正常。未发现未解决P0/P1/P2。

client SHA256 `ebe3a393a090d60c1401bca785b00f3d7051790042a1cc6d3e8a53f1d4f133bc`；原生已刷新v0.4.7，原会话只读验证；真实chats.json哈希不变。私有原稿、对话、截图位于round `20261113-followup-0.4.7`，不得提交。


## 2026-11-13 · 0.4.7 公共文档截图

final result: passed（公共截图与隐私gate；产品功能复用上一轮0.4.7验收）

7张新版真实UI截图已由唯一媒体owner逐张亲检：library、PDF+AI与p1附件、整页notes、cards目录、cardeditor预览、research专题、discovery初始态。仅独立公开合成demo副本；手写示例对话/笔记/卡片明确演示，非真实模型证据；没有新模型或检索请求。

viewport1720×1080，截图API clip{x:280,y:0,width:1440,height:1080}直接输出原始JPEG，未重编码、不改像素内容。整个Harness侧栏及Chrome栏排除，无用户姓名头像、业务会话、本地路径或鉴权URL。逐图SHA/隐私判定见私有round `20261113-docs-screenshots-0.4.7/results/public-screenshots-manifest.json`，主agent统一引用并淘汰旧图。截图候选本身可公开；私有profile/fixture路径不提交。
