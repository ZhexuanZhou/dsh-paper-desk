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
