# 发布知页 · 论文助手

产品显示名称为“知页 · 论文助手”，英文为 Paper Companion。技术安装标识保留 `dsh-paper-desk`，公开 npm 包保留 `@zhe_xuan/dsh-paper-desk`，用于兼容已有安装、工具与论文库。改显示名称不需要迁移数据。

Git tag、GitHub Release、npm 和社区市场是独立渠道。创建 tag 不会自动发布安装包，也不会更新 npm 或市场版本。

## 检查与打包

在仓库根目录执行：

```sh
npm run typecheck
npm run build
npm run smoke
npm run test:regression
npm run test:markdown
```

按本轮变更补充运行对应专项检查，并完成真实界面验收。界面审查记录在 `design-qa.md`；每个版本的验证范围和限制写入对应发布说明。

发布包使用既有脚本转换为公开的 scoped 身份：

```sh
node scripts/publish-package.mjs --pack
```

脚本会将构建产物复制到 `.publish/npm/`，统一包名、Cordis 插件引用和客户端 module-loader 标识。检查生成的 tgz，确保包含 `lib/`、locale、插件配置、图标和截图；不包含 `.acceptances/`、测试库、个人路径或凭据。`screenshots.json` 保持 1–8 张真实界面图。

## GitHub Release

以 1.1.0 为例，先提交已验收的源码：

```sh
git add <reviewed-files>
git commit -m "chore(release): release v1.1.0"
git tag -a v1.1.0 -m "知页 · 论文助手 1.1.0"
git push origin main v1.1.0
```

将 scoped tgz 复制为面向安装者的附件名，放到忽略目录 `.publish/releases/`：

```sh
mkdir -p .publish/releases
cp .publish/npm/zhe_xuan-dsh-paper-desk-1.1.0.tgz .publish/releases/dsh-paper-desk-1.1.0.tgz
gh release create v1.1.0 \
  --verify-tag \
  --title "知页 · 论文助手 1.1" \
  --notes-file docs/RELEASE-v1.1.0.md \
  --latest \
  .publish/releases/dsh-paper-desk-1.1.0.tgz
```

发布后核对 Latest、tag 指向的提交及附件下载。GitHub 安装方式：

```sh
dsh plugin --profile <profile> add https://github.com/ZhexuanZhou/dsh-paper-desk/releases/download/v1.1.0/dsh-paper-desk-1.1.0.tgz
```

桌面应用管理的 profile 应在应用的插件管理器中更新和重载。不要通过 CLI 改写正在运行的桌面 profile。

## npm 与社区市场

只有需要同步 npm 渠道时才执行发布：

```sh
node scripts/publish-package.mjs --publish
npm view @zhe_xuan/dsh-paper-desk version
```

发布需要当前账号的包权限及 registry 验证。不要把 token 写入源码、发布说明或日志。

社区市场条目继续指向原仓库与公开包。版本、收录状态和下载源应以实际查询为准；README 不应将源码版本或 GitHub Release 版本当作已发布的 npm 版本。更新市场条目属于独立操作。
