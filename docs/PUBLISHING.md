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

## 2. npm：发布包（scope: `@zhe_xuan`）

npm 会拒绝无 scope 的 `dsh-paper-desk`，因为它与已存在的包 `dsh-paperdesk` **名称过于相似**
（`403 Package name too similar ... try renaming your package to '@zhe_xuan/dsh-paper-desk'`）。
所以公开包名是 **`@zhe_xuan/dsh-paper-desk`**，但仓库内 `package.json` 仍保留无 scope 的
`dsh-paper-desk`，这样本地 profile 的 `link:` 安装不受影响。

发布用 `scripts/publish-package.mjs` 做一次“换身份”打包：复制构建产物到 `.publish/npm/`
（已在 `.gitignore`），把 `package.json.name`、`cordis.patch.yml` 的 insert `name` 和
`lib/client.js` 的 module-loader `id` 统一改成 scoped 名，然后从该目录发布：

```sh
./node_modules/.bin/tsc -p tsconfig.json && node scripts/build-client.mjs
node scripts/publish-package.mjs --publish      # 等价于 stage + npm publish --access public
npm view @zhe_xuan/dsh-paper-desk version
```

- 发布前需要 token：npm 网页登录 token 不能发布（会报 2FA 403），要到
  <https://www.npmjs.com/settings/zhe_xuan/tokens> 建 **Granular token → Permissions 选
  `Read and write (publish and stage)` → Packages `All packages` → 勾 Bypass 2FA**，
  或 **Classic Token → Automation**，然后：
  ```sh
  npm config set //registry.npmjs.org/:_authToken=npm_xxx
  ```
- 以后升级：改 `version` → 构建 → `node scripts/publish-package.mjs --publish` →
  `git tag` / Release。市场按 registry 版本显示更新。
- 预构建 tarball 也必须是 scoped 身份（`node scripts/publish-package.mjs --pack`），再上传到
  Release 同名资产 `dsh-paper-desk-<version>.tgz`。

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
# 可选：npm 发布前的预构建安装包（Release 里的 tgz，tag 钉死不随发版 404）
tarball: https://github.com/ZhexuanZhou/dsh-paper-desk/releases/download/v0.3.0/dsh-paper-desk-0.3.0.tgz
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


## 当前状态（2026-11-09）

- npm 已发布：**`@zhe_xuan/dsh-paper-desk@0.3.31`**（scope 是 npm 名称相似规则要求的）。
- 市场 PR：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13433>，
  `Submission gate` ✅、`check` ✅、`MERGEABLE`，等维护者合并。
- Release：<https://github.com/ZhexuanZhou/dsh-paper-desk/releases/tag/v0.3.0>，
  预构建 tarball 已替换为 scoped 版本，条目里的 `tarball:` 仍指向同一 URL。
- 市场条目不需要 npm 字段：registry 会按已发布包的 `repository` 自动把 npm 下载量和条目关联。
