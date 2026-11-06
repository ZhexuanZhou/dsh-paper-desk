# 发布 PaperDesk（npm + DSH 社区市场）

PaperDesk 是标准 DSH 插件包：`package.json` 里有 `dsh.bundle`（`cordis.patch.yml`）与
`dsh.client`，Code 已预构建进 `lib/`。发布分三步：**打 tag 发 Release → 发 npm → 向
awesome-dsh-plugin 提交一个条目**。市场（dshmarket）从该列表同步，条目合并后 1 天左右自动出现。

本文所有命令都在仓库根目录执行：

```sh
cd /Users/zhexuansoffice/Developments/dsh_plugins/dsh-paper-desk
```

## 0. 发布前检查

```sh
# 类型 + 构建 + 冒烟（会重写 lib/，prepack 也会跑 build）
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/tsc --noEmit -p tsconfig.client.json
node scripts/smoke.mjs

# 检查真正会被发布进 npm 包的文件
npm pack --dry-run
```

需要确认：

- `package.json`：`private` 必须不存在（现在已删）、`dsh.bundle.patch` 指向存在的 `cordis.patch.yml`。
- `repository.url` 指回 `https://github.com/ZhexuanZhou/dsh-paper-desk`（市场靠它把 npm 包和列表条目关联）。
- `lib/index.js`、`lib/client.js`、`lib/index.d.ts`、`lib/client.d.ts` 都在包内。
- `screenshots.json`（1–8 张 GitHub 仓库内图片）与 `assets/icon-180.png` 在包内/仓库内；市场卡片与详情页截图会用到。
- `demo/library` 是给用户试用的示例数据，不应因此进入 npm 包（目前 `files` 未包含 demo）。

## 1. GitHub：第一个 Release

```sh
git add -A
git commit -m "release: v0.3.0"
git tag -a v0.3.0 -m "PaperDesk v0.3.0"
git push origin main --tags

# 预构建包（供 GitHub 安装 / 市场 tarball 备用）
npm pack            # 生成 dsh-paper-desk-0.3.0.tgz
# 示例数据 zip（可选）
cd demo && zip -r ../paperdesk-demo-library.zip library && cd ..

gh release create v0.3.0 \
  --title "PaperDesk v0.3.0 — 第一个版本" \
  --notes-file docs/RELEASE-v0.3.0.md \
  ./dsh-paper-desk-0.3.0.tgz \
  ./paperdesk-demo-library.zip
```

Release 里的 tgz 可作为 `tarball:` 安装源：

```sh
dsh plugin --profile web add https://github.com/ZhexuanZhou/dsh-paper-desk/releases/download/v0.3.0/dsh-paper-desk-0.3.0.tgz
```

## 2. npm：发布包

需要 npm 账号（当前机器 `npm whoami` 未登录，先登录一次；**不要把 token 发到对话里**）：

```sh
npm login
npm publish        # prepack = npm run build，自动产出 lib/
npm view dsh-paper-desk version
```

- 包名 `dsh-paper-desk` 目前未被占用（已查 404）。
- `publishConfig.access = public` 已设置；无 scope 的包默认就是 public。
- `@deepseek-ai/*` 已按市场规范放到 `peerDependencies`（官方运行时由 DSH 提供），
  `marked`/`pdfjs-dist` 仍在 `dependencies`。
- 以后升级：改 `version` → `npm publish` → `git tag`/Release。市场会按 registry 版本显示更新。

## 3. 市场条目：awesome-dsh-plugin PR

市场 dshmarket 的安装限制在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
列表内；收录 = 给该仓库提一个 **只新增 1 个文件** 的 PR：

1. Fork / clone <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。
2. 新增 `data/plugins/ZhexuanZhou__dsh-paper-desk.yml`：

```yaml
url: https://github.com/ZhexuanZhou/dsh-paper-desk
name: ZhexuanZhou/dsh-paper-desk
category: tools
description:
  en: Mendeley-style paper library for DeepSeek Harness — import PDFs, read them in-app with highlights, notes and questions, generate note cards from AI answers, compare 2–6 papers, build a typed relation graph, and sync the library folder through any cloud drive.
  zh: 给 DeepSeek Harness 的 Mendeley 式论文库——导入 PDF、在面板内阅读并做高亮/划线/笔记/提问、把 AI 回答生成笔记卡片、对比 2–6 篇论文、建立带类型的论文关联图谱，并把库目录交给云盘同步。
icon: https://raw.githubusercontent.com/ZhexuanZhou/dsh-paper-desk/main/assets/icon-180.png
```

> 分类 `tools` 是按「论文管理与阅读工具」选的；维护者可能根据实际内容调整分类，这不影响收录。
> 描述里不要写没做的功能或夸大数字（会被逐条对照源码检查）。

3. 提 PR（标题如 `Add ZhexuanZhou/dsh-paper-desk`），按 CI 提示修；维护者会读源码后合并。
4. 合并后站点/市场自动重建，通常 **1 天内** 出现在 dshmarket 的 Tools 分类。

### 收录硬性条件（当前状态）

| 条件 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle`（不是只有 `dsh.client`） | ✅ `dsh.bundle.patch = ./cordis.patch.yml` |
| 仓库有真实可用代码 | ✅ |
| 仓库创建满 **1 天** | ⏳ 本仓库 2026-11-06 才创建，需等到创建满 1 天后再提 PR（CI 自动检查，提前提会被拒） |
| 仓库加 `dsh-plugin` topic | ⬜ 执行：`gh repo edit ZhexuanZhou/dsh-paper-desk --add-topic dsh-plugin` |
| 只新增自己的条目、最多 3 条 | ✅ PR 只加 1 个文件 |
| 描述准确、无营销词 | ✅ 提 PR 前再对一次代码 |

其他可选加分项：

- `screenshots.json`（已在仓库根，8 张面板截图）→ 市场详情页 AppStore 式截图。
- `icon-180.png`（GitHub 托管的位图；SVG 会被拒）→ 市场卡片图标。
- npm 已发布 → 市场显示下载量、按下载量排序。
- GitHub Release 附预构建 tgz → 网络差时仍可秒装（`tarball:` 字段可选，但 npm 已足够）。

## 4. 用户安装方式（发布后）

```sh
# 从 npm（市场/手动都走这个）
dsh plugin --profile web add dsh-paper-desk

# 桌面版：设置 → 插件 → 搜索 dsh-paper-desk
```

市场里安装后一般刷新页面即可，无需重启；插件会出现在左侧栏「PaperDesk Library」。

## 5. 版本与更新节奏

- 语义化版本：小功能 +0.1，修复 +0.0.1；每次发版同步 `package.json`、`git tag`、GitHub Release、npm。
- 市场靠 npm 版本号检测更新；列表条目本身不用改。
- 如果以后改仓库名或 npm 包名，记得同步 `package.json.repository` 和市场条目 `url`，否则两者会解绑。

## 6. 安全与隐私（提 PR 时会被看到）

- 插件只读写用户选择的论文库目录（默认 `~/Documents/PaperDesk`），不做网络回传。
- Crossref 只在 `enrich` 开启时请求公开元数据；AI 能力走 DSH 自己的会话，不额外拿密钥。
- 云盘同步由用户自己的网盘客户端完成，插件只写普通文件（原子写 + 冲突副本）。
