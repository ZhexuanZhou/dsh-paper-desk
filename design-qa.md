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


## 2026-11-16 · 0.4.8 自然语言Agent与回答选区

final result: passed（6项隔离Web验收；本地Harness已于今日授权暂停后通过插件管理器关闭/开启完成更新）

最终client SHA256 `abf7124d887eb459bec665c6ae95d0e1ff43562aa39d1cab4ab0dcaba8d5c36f`，Host tools `210bb8f5c1bdb6dd800000eeeb0906c708b6dd2bac7073cf903d069bb0c10085`。沿用用户选1视觉方向，唯一媒体owner亲检真实UI：任务下拉/空态固定任务及回答保存菜单移除；紧凑问题可展开/收起，连续推理与工具默认单条折叠过程；回答选区改为输入框上方内联区，600×900按钮可达，不覆盖正文。最终Esc补验：第一次仅关闭选区并保留AI，第二次正常关闭AI。无未解决P0/P1/P2。

4次真实deepseek-official/deepseek-flash分别验证只读总结、明确追加笔记、创建卡片、保留原卡整理综合卡；实际tool/call与返回逐字段对照隔离文件。总结前后notes/cards哈希相同；笔记追加不删除原行；原卡业务字段/时间戳保留，可选空context数组被规范化省略，不声称JSON字节不变。复制Markdown与1256字符原回答完全一致，含TeX源码。实际回答批注保存在浏览器localStorage，取消与保存均验证，不声称写入论文文件。

主agent提供188项自动化通过补证；其中工具真实落盘18项、草稿25项、过程分组7项。自动化与真实模型证据分开记录，模型未执行update，旧task兼容未人为注入storage。此前d557/0cdd/a9e7构建中未受后续文案或Esc修复影响的证据保留各自来源，最终键盘行为使用abf7实测。

两张公共JPEG候选仅独立合成demo与本轮真实模型输出，已逐张亲检隐私与布局；裁除整个宿主个人侧栏和Chrome地址栏，无姓名头像、业务对话、本地路径或鉴权URL。自然语言图直接区域捕获；选区图由原始真实捕获裁切并JPEG重编码，未改变UI内容。公共候选及逐图来源见私有round `20261116-natural-language-agent/results/public-candidates-manifest.json`。本轮6项各含截图与文本，共12份required evidence；真实库未写入。

0.4.8原生补充：今日明确暂停授权后，插件管理器on→off→on完成，无整应用重启；回Library观察界面/后台均v0.4.8、自然语言输入及复制Markdown，无旧task/回答保存菜单。未发模型或编辑真实库/对话。原生UI未单独展示create/update schema，不伪称工具执行复验；沿用隔离真实模型与工具证据。补充AX记录位于本轮results/native-reload.txt，Web原6项来源与12份required evidence不变。


## 2026-11-16 · 0.5.0 编辑重组、版本恢复与对话面板

final result: passed

最终client `a79c9b882fa988e9e2d11e795d9f28190fbd3204bb262676992936b9a203d1e3`。唯一媒体owner亲检宽屏与600×900：统一会话菜单、新建、重命名/取消删除、顶部笔记/卡片导航；草稿自动增高、生成中可编辑下一条、切换草稿不串；窄屏正文/按钮可达，表格/公式独立overflow容器且父正文不溢出。实际回答未形成超长公式，不声称拖动极长公式已验。历史共享Modal可预览完整笔记/卡片集合，恢复与撤销按钮可达。删卡旧“无法恢复”提示已修并fresh确认。无未解决P0/P1/P2。

5次真实deepseek-official/deepseek-flash请求完成整篇笔记去重、卡片内容合并拆分、排序补验和两类对话历史恢复；文件与目标快照逐字节核对。UI恢复/撤销双向核对及手动编辑/删除前快照已实测，冲突/失败原子性等以主agent44项历史专项及8项预览补证，不混作真实模型。首批cards工具返回undefined被真实宿主lossless JSON拒绝，虽然已写入模型仍诚实读回；修后真实move成功返回与落盘一致。修前证据保留，后续构建仅文案/样式不重跑模型。

两张最终0.5.0公共JPEG为独立合成demo与本轮真实模型回答，裁除整个宿主个人侧栏/Chrome地址，无用户身份、业务会话、私有路径或鉴权URL；原1701×913裁为1421×913并JPEG重编码，UI内容未改。逐张亲检及SHA见私有round `20261116-versions-followup-0.5.0/results/public-candidates-manifest.json`。

今日明确暂停授权后原生插件管理器off/on更新，界面与后台均v0.5.0；只读确认新会话管理和版本历史入口。未发模型、编辑或恢复真实内容。Web5项/10份required evidence，native作为补充观察，不替代隔离写入证据。

主agent最终自动化共259项（44历史编辑+8预览+18工具+33smoke+67regression+57Markdown+25composer+7display），另typecheck/build通过；不将这些计为真实模型。原生未独立检查工具schema或执行写工具，仅版本及入口只读观察。


## 2026-11-16 · 0.5.1 显式回答批注

final result: passed

client `e5fa63cf5c8b54b39d1cf013973c2d68fb8465c983133ebf4b6873bba2c80b0a`。两项隔离真实操作通过：鼠标选词和Shift方向键扩展只保留原生选区，不开编辑区；面板/输入框尺寸和滚动均不变。固定footer“批注选中内容”按钮占原操作行，明确点击才打开正确引用。取消、实际保存、Esc、取消选区/跨回答禁用均实测；保存为浏览器localStorage，论文notes/cards/chats/PDF文件未改。复制Markdown与原回答字节一致；本轮回答无TeX，不伪称新测公式。无模型调用，不重跑历史编辑或PDF选择。唯一媒体owner已亲检两张真实JPEG，无未解决P0/P1/P2。

主agent typecheck/build与82项自动化（25composer+57 delivered Markdown）补证通过。native fresh guard实际已显示界面v0.5.1和固定批注按钮，后台报告缓存v0.5.0如实保留；Host逻辑未改，未额外off/on或修改真实内容。2/2项、4份required evidence，私有round `20261116-z-selection-followup-0.5.1`。


## 2026-11-16 · 0.5.2 卡片阅读与预览统一

final result: passed（2项隔离Web局部验收）

最终client `58dd8363b2c9b9b4bfeefbed7870f2d2c71dd52edb4a8ee86638f6028c905b44`。唯一owner亲检宽屏/600×900：reader与preview共用sans16/29.6px正文、H2 19px无绿分隔边框、table14自身横滚，正文小节/标题左边线一致，无正文max70ch居中。ul祖先继承造成circle/disc差异已修，最终两处disc。表格/列表/公式可读，窄屏Modal保存取消可达，临时viewport已reset。无未解决P0/P1/P2。

同名首heading或独立段落仅展示省略，原编辑body/卡片文件字节保留；复制沿用来源wrapper且保留完整原body与TeX。不同标题、代码、quote保留实测；含link/inlinecode首块新边界由主agent85项delivered Markdown检查补证，另typecheck/build通过。不新模型、不改notes/真实库。9d92窄屏/原文证据保留原出处，仅bullet补验与公共图用最终58dd。

两张最终公共JPEG仅公开合成fixture，裁掉完整宿主个人侧栏，无身份、旧业务、路径或鉴权URL；1701×913裁为1421×913并重编码，UI内容未改，逐张亲检。manifest位于本轮results/public-candidates-manifest.json。2/2项共4份required evidence。native初态已见界面v0.5.2/后台缓存v0.5.0；只读卡片动作后用户切业务页即停，未独立确认原生卡片布局，未写真实内容。


## 2026-11-16 · v1.0.0 全局界面审查

### 范围与结论

本轮唯一UI owner通过隔离的真实 DSH Web 宿主审查知页 · 论文助手。界面和后台报告均显示 v1.0.0，fixture为4篇合成论文、5张合成卡片。所有可逆写入只针对本轮fixture；没有改真实资料。一次只读模型问答和一次OpenAlex检索/订阅均按本轮授权执行。

`lh acceptance run validate` 对8项criteria和8个case校验有效。离线报告包含51项证据，没有缺失或失效证据。总评为 partial；这不表示8项全部通过。通过2项，另6项有未验证边界：

| 审查面 | 结果 | 实测与边界 |
|---|---|---|
| 论文库、比较、图谱 | blocked | 4篇库与4节点/11关系全图可读；Compare焦点环复验通过。Graph第一次CUA Escape没有出现在DOM事件trace，第二次到达handler并关闭；原因未知，不能据此归因产品或宿主。 |
| PDF阅读与批注 | blocked | 合成PDF高亮新增、Cmd+Z撤销，暗/白纸张可切换；窄屏和浏览器缩放未测。 |
| AI助读对话 | blocked | 1次只读合成论文问答；长问题初始完整显示，手动折叠/展开已测。剪贴板读取为空，精确复制字节未证实；模型调用时的provider/model身份未确认；未单测重载后的折叠状态。 |
| 笔记、卡片、历史 | pass | 合成笔记marker通过版本历史恢复；卡片删除确认、取消和历史预览可达，原笔记哈希恢复。 |
| 论文信息与研究专题 | pass | 两篇合成论文专题保存并重载后保留。 |
| 文献发现与订阅 | blocked | OpenAlex公开检索返回20条；创建/重开/删除测试订阅通过；外部来源错误恢复未测。 |
| 统一导入 | blocked | URL与DOI错误反馈保留输入；锁屏时未打开原生PDF chooser，没有新建导入。 |
| 设置、同步、响应式 | blocked | 本地扫描19个跟踪文件、4个PDF，新增/变更/移除均0；Harness浅色外观检查后恢复跟随系统。窄屏/缩放无受支持的CUA viewport控制。 |

没有据此声明完整WCAG符合性、真实模型质量、云端同步或真实资料导入。

### 截图候选

本轮真实v1.0.0 UI图已裁掉Harness个人侧栏并重新编码为JPEG。8张候选位于[`docs/screenshots/v1.0.0/`](docs/screenshots/v1.0.0/)，逐张的原图SHA、候选SHA、构建来源和隐私处理见[`public-candidates-manifest.json`](docs/screenshots/v1.0.0/public-candidates-manifest.json)。截图展示合成fixture；文献发现图展示公开OpenAlex结果。未使用私有Escape probe或旧0.5.2截图。

没有干净的卡片编辑器after图；现存图片只有删除确认弹窗，故未冒充编辑器图。链接tab截图仍显示修正文案前的元数据说明，未作为import-link候选。本轮提供统一导入的本地PDF弹窗图，不将其称为链接导入图。8张已加入`screenshots.json`，README 已引用本轮截图。

### 可复核报告

本轮离线报告：本地忽略目录中的 `.acceptances/standalone-paperdesk-redesign/report.html`。最终键盘焦点与hover配色改动已构建，client SHA256为 `5da6c8f994c3058bfa750b0a369b40ab170c92428b39cbd7d44a975da001a9b9`。本轮截图保留各自构建来源，不声称全部来自最终构建。解锁后需补验受影响交互、原生文件选择与本地插件重载，以及窄屏、缩放和复制原文。

### 2026-11-17 最终补验修订

上一节的补验待办已部分完成。最终候选为 client SHA256 `a19b5251062ef3a4f8044a567964f59c9791ddfcf57729a8868754c0bd8ab04b`，版本 `1.0.0`；真实隔离页面的前端与后台均报告 `1.0.0`。`lh acceptance run validate` 对 8 个 criteria / 8 个 case 验证有效；补入最终截图与文本后共有 61 项有效证据。整体仍为 **partial**，不表示8项全通过。

- 已通过最终界面复验：Native插件管理器开关从 off 到 on，退出管理器后插件重载成功；native真实库未改，仅只读查看。隔离 fixture 显示4篇合成论文。
- Native PDF chooser 选择的文件与库内合成 PDF SHA256 完全相同；界面提示论文已在库中并重新选择原 paperId，库仍为4篇。此为重复检测，不触发新 PDF 元数据模型处理。
- PDF选择工具栏新增“加入提问”实测通过。选中文本后，正常 composer 收到页码与引用；复测保留原有草稿并追加第二段引用。未自动发送，回答/批注数量未变化，测试草稿已清空。
- Chrome原生QA标签 Zoom=125%时，最终a19b界面截图为1360×730，工具栏、列表、PDF区仍可见，未发现水平溢出；随后原生Reset回100%。这不是390 CSS px或实际DOM scrollWidth验证。Graph在原生按键调用后窗口仍开，焦点回页面根节点，未证明按键到达DOM；用“取消”正常关闭。首个事件缺失仍不归因插件。
- 外部来源失败/冷却UI本轮未重测，但0.4.2轮有真实arXiv成功和独立API边界5秒冷却禁用/恢复、切OpenAlex后返回20篇的记录；该证据按历史版本引用，不称本轮真实429。导入busy未测，src/urlImport.ts拒绝loopback/私网URL，没有用本地代理造慢响应。
- 长问题折叠、答案复制精确 Markdown、专题/笔记历史、PDF高亮撤销、OpenAlex订阅、同步扫描沿用有效真实UI结果。自动检查676项由主执行者报告，未计为人工UI证据。
- Chrome原生窗口仍包含用户其他tabs；我通过tabstrip选中唯一明确的“DeepSeek Harness”QA标签，但不调共享窗口边界。原生125%缩放已测并恢复100%；CUA viewport override不可用，宽窗口侧栏约320px的旧证据不等于390px viewport。最终390 CSS px/实际DOM尺寸未验证。Graph按键送达DOM与导入busy状态仍未确认。
- 最终补验的详细行为、SHA和局限见本轮 `results/qa-observations.md`；本地验收报告入口为 `.acceptances/standalone-paperdesk-redesign/report.html`。没有具体模型路由证据，不猜 provider/model；没有声称完整 WCAG 合规。
- 我亲检并更新 `docs/screenshots/v1.0.0/library.jpg` 与 `ai-reading.jpg` 两张公开合成UI候选，均来自 a19b525 新截图；manifest记录 source/candidate SHA 和去除Harness侧栏的裁切。无新的合格 card-editor 或 import-link 截图，仍保留这两项缺口。


### 2026-11-17 桌面 1.0 发布判断

主执行者按用户要求的 macOS 桌面插件范围接受本版核心交付。依据包括实际8个功能面的操作、原生文件选择去重、本地前后端1.0.0、125%浏览器缩放、侧栏两种宽度、统一使用正常输入框的草稿流程，以及类型检查、构建和676项自动检查通过。最终client仍为 `a19b5251062ef3a4f8044a567964f59c9791ddfcf57729a8868754c0bd8ab04b`。

最终离线报告为8个检查面、61份证据，缺失和失效证据均为0。报告保留partial：390px极窄视口、慢速导入后台延续和空搜索框Escape是否送达仍有验证限制。它们作为补充边界公开记录，没有伪称通过，也没有把未送达输入定性为产品处理错误。本次发布不宣称移动版或完整WCAG符合性；界面检查和功能结果的范围见上文逐项记录。

验证只在合成库写入；本地真实库只读。本轮隔离设置已恢复，草稿与评论测试数据已清理，仅停止本轮自建服务，真实应用保持启用。

## 1.1 研究专题与批量导入（2026-11-17）

专题以解读为主区，问题和文献收进设置，笔记与卡片按需展开。公开截图使用合成库和真实模型报告；来源与裁切见 `docs/screenshots/v1.1.0/manifest.json`，其余未改页面保留 1.0 标注。

- 创建两篇专题会自动生成并保存解读。验收发现过模型和页面重复保存的冲突；生成阶段现要求只读资料并输出正文，由页面保存。补验结果与保存 Markdown 逐字一致，重开未重复提交。右侧明确要求编辑时仍可修改三个专题文档。
- 35 篇专题选两篇的真实问答仅调用两次选定论文的 `paper_text(page: 1)`，没有写工具，专题内容及更新时间不变。增减未选文献后仍保留两篇讨论范围。
- 卡片保存在专题并关联来源，未写到单篇论文卡片。笔记、卡片的旧版本可在 UI 恢复，其他文档不变；解读完整及空版本恢复另有专项检查。未保存草稿时禁用历史、结束和更新解读；放弃修改只恢复本地预览。
- 专题默认结束不批量已读；明确勾选后只更新非归档论文，重开与全局阅读状态分开。标题区阅读状态使用独立菜单。
- 链接队列实测重复、错误、单项重试、新公开 W3C 测试 PDF 入库和再次去重。元数据空字段未全部补齐，不宣称完整补全。关闭弹窗后后台完成已观察；导入完成与新草稿重叠未形成真实 UI 前提，另有生产保护函数的异步时序检查，不冒充 UI 实测。
- 最终客户端为 `cf04791ed6ba411e09e241bb39649e92277babab25ed40a5db029d02ebf7c277`。图片保留实际构建来源。类型检查、构建及 18 套共 780 项自动检查通过。
- Native 经真实插件管理器重载后，前后端均显示 1.1.0，专题页通过能力检查正常加载；这是代码与页面结果的推论，未直接读取布尔字段。没有真实论文内容编辑或模型任务；重载前无可比选择信号，不宣称本轮选择保持实测。

本轮仅隔离合成库写入，共五次实际请求：首次生成冲突、修复生成、三个文档编辑、公开 PDF 元数据和大专题只读讨论。未扩大浏览器文件权限或绕过 URL 安全规则。此前 1.0 极窄屏等边界仍按原记录保留，本轮不宣称新增移动端支持或完整 WCAG 符合性。
