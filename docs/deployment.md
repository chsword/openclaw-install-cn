# 部署指南 / Deployment Guide

本文档说明当前仓库的发布、同步和 CDN 部署模型。

## 架构概览

当前架构已经简化为两条独立链路：

1. `release.yml` 负责发布安装器自身
2. `sync-openclaw.yml` 负责更新最新 OpenClaw 版本标记

对应职责如下：

- `release.yml`
  - 构建并发布 `oclaw` CLI
  - 构建并发布 GUI 安装程序
  - 上传 `install.sh`、`install.ps1`
  - 上传 `cli-manifest.json`
- `sync-openclaw.yml`
  - 查询上游 OpenClaw 最新版本
  - 更新 `cdn-template/manifest.json`
  - 上传 CDN 根目录的 `manifest.json`
  - 刷新 `manifest.json` 缓存

注意：仓库不再同步、缓存、打包或上传 OpenClaw 离线安装包。

## 当前安装模型

CLI、GUI 和引导脚本都会先检查：

1. Node.js 是否已安装，且版本不低于 18
2. pnpm 是否已安装
3. 当前是否已安装 OpenClaw
4. 当前版本与最新版本是否存在差异

实际安装与升级统一通过以下命令完成：

```bash
pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
```

`manifest.json` 只用于标记当前最新的 OpenClaw 版本，不再承载平台包列表和校验和。

## GitHub Actions 环境配置

如果需要将文件上传到腾讯云 COS，请在 GitHub Environments 中配置 `TencentSecretId` 环境，并提供：

- `SECRETID`
- `SECRETKEY`
- `BUCKET`
- `REGION`

建议只授予最小的 COS 读写权限。

## 发布安装器版本

推荐流程：

1. 更新 [cli/package.json](../cli/package.json) 中的版本号
2. 推送到 `main`
3. 等待 `ci.yml` 自动打标签
4. 等待 `release.yml` 构建和发布

`release.yml` 会：

- 构建 Windows、macOS、Linux CLI 二进制
- 构建 GUI 安装包
- 更新 `cdn-template/cli-manifest.json`
- 创建 GitHub Release
- 上传 CLI、GUI、引导脚本和 `cli-manifest.json` 到 COS/CDN

## 同步 OpenClaw 最新版本

`sync-openclaw.yml` 只做一件事：让 CDN 上的 `manifest.json` 始终反映 OpenClaw 最新版本。

当前工作流步骤：

1. 从上游 Release API 读取最新版本，或使用手动输入版本
2. 对比 `cdn-template/manifest.json` 中的 `latest`
3. 写回新的 `latest`、`releaseDate` 和 `description`
4. 上传 `manifest.json` 到 COS/CDN
5. 刷新该文件的 CDN 缓存

## CDN 目录结构

当前 CDN 根目录建议结构如下：

```text
(CDN Root)/
├── manifest.json
├── cli-manifest.json
├── install.sh
├── install.ps1
├── cli/
│   └── {version}/
│       └── oclaw-*
└── gui/
    └── {version}/
        └── openclaw-gui-*
```

不再使用 `pkg/{version}/openclaw-*` 目录。

## 用户侧流程

用户可以通过以下方式安装：

```bash
curl -fsSL https://oclaw.chatu.plus/install.sh | bash
```

或在 Windows PowerShell 中：

```powershell
irm https://oclaw.chatu.plus/install.ps1 | iex
```

CLI 和 GUI 都会在安装前检查环境，并通过 pnpm 完成真正的安装或升级。

## 故障排查

### 无法检查最新版本

确认 CDN 上的 `manifest.json` 可访问：

```bash
curl -I https://oclaw.chatu.plus/manifest.json
```

### 无法安装或升级 OpenClaw

优先检查：

1. `node --version`
2. `pnpm --version`
3. `openclaw --version`
4. 是否能访问 `https://registry.npmmirror.com`

### Release 发布后 CDN 内容未更新

检查：

1. `release.yml` 的 `deploy-to-cos` 是否成功
2. `sync-openclaw.yml` 是否已更新 `manifest.json`
3. CDN 刷新任务是否成功执行
   curl https://oclaw.chatu.plus/manifest.json
   ```
2. 确认 `versions` 数组中包含对应版本
3. CDN 缓存由 `sync-openclaw.yml` 通过 `tccli cdn PurgeUrlsCache` 自动刷新；若仍有缓存问题，可在腾讯云 CDN 控制台 → 刷新预热 → 手动刷新 `manifest.json` 的缓存

### deploy-to-cos 任务失败

1. 确认 `TencentSecretId` 环境中的 SECRETID、SECRETKEY、BUCKET、REGION 值正确
2. 确认子账号有 COS 写入权限
3. 查看 Actions 日志中的详细错误信息

### CLI 二进制在 macOS 上提示"无法打开，因为来自身份不明的开发者"

```bash
# 移除隔离标记
xattr -dr com.apple.quarantine /usr/local/bin/oclaw
# 或者
chmod +x oclaw-darwin-x64
./oclaw-darwin-x64 status
```

### Windows 杀毒软件误报

`oclaw-win-x64.exe` 是由 `pkg` 打包的 Node.js 可执行文件，部分杀毒软件可能误报。
用户可通过 SHA-256 校验和（`checksums.sha256`）验证文件完整性：

```powershell
Get-FileHash oclaw-win-x64.exe -Algorithm SHA256
# 对比 checksums.sha256 中的值
```
