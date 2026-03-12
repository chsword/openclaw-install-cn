# openclaw-install-cn

<p align="center">
  <a href="https://github.com/chsword/openclaw-install-cn/actions/workflows/ci.yml">
    <img src="https://github.com/chsword/openclaw-install-cn/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/chsword/openclaw-install-cn/actions/workflows/release.yml">
    <img src="https://github.com/chsword/openclaw-install-cn/actions/workflows/release.yml/badge.svg" alt="Release">
  </a>
  <a href="https://github.com/chsword/openclaw-install-cn/releases/latest">
    <img src="https://img.shields.io/github/v/release/chsword/openclaw-install-cn?label=latest" alt="Latest Release">
  </a>
</p>

<p align="center">
  OpenClaw 中国大陆安装助手<br>
  使用 pnpm 与 npmmirror 安装和升级 <a href="https://openclaw.ai/">OpenClaw</a>
</p>

## 项目说明

这个仓库不再缓存、下载或构建离线版 OpenClaw 安装包。

当前模型是：

- CLI、GUI 和引导脚本先检查 Node.js、pnpm、OpenClaw 当前版本
- `cdn-template/manifest.json` 只记录 OpenClaw 最新版本号，供升级检查使用
- 实际安装和升级由助手自动执行，并统一使用中国大陆可访问的 npm 镜像源

仓库中仍然发布 `oclaw` CLI、GUI 安装程序以及引导脚本，方便用户在中国大陆环境下完成环境检查和安装引导。

## 快速开始

### 一键引导脚本

macOS / Linux：

```bash
curl -fsSL https://oclaw.chatu.plus/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://oclaw.chatu.plus/install.ps1 | iex
```

引导脚本会执行以下流程：

1. 检查 Node.js 是否已安装且版本不低于 18
2. 检查 pnpm 是否可用，缺失时尝试通过 npm 安装
3. 检查当前是否已安装 OpenClaw
4. 执行 pnpm 全局安装或升级命令

### 直接使用 CLI

```bash
git clone https://github.com/chsword/openclaw-install-cn.git
cd openclaw-install-cn/cli
npm install

node bin/oclaw.js status --check-updates
node bin/oclaw.js install
node bin/oclaw.js upgrade
```

## CLI 用法

```text
oclaw <command> [options]

Commands:
  install [options]   检查环境并安装 OpenClaw
  upgrade [options]   检查并升级到最新版本
  status  [options]   显示 Node.js、pnpm、OpenClaw 和最新版本状态
  config  [options]   查看或重置 oclaw 配置

Global options:
  --verbose           启用详细输出

install options:
  --force             强制重新安装

upgrade options:
  --check             仅检查更新，不执行升级
  --json              以 JSON 格式输出结果

status options:
  --check-updates     同时查询最新版本
  --json              以 JSON 格式输出结果

config options:
  --reset             重置为默认配置
  --list              列出当前配置（默认行为）
  --json              以 JSON 格式输出结果
```

默认配置文件位置：

- Linux / macOS: `~/.oclaw/config.json`
- Windows: `%USERPROFILE%\.oclaw\config.json`

## GUI

GUI 基于 Electron，提供图形化的环境检查、版本检查、安装和升级流程。

主要能力：

- 显示当前 OpenClaw 版本和最新版本
- 显示 Node.js、pnpm 是否可用
- 在缺少前置条件时给出明确提示
- 调用 pnpm 完成安装或升级
- 查看安装日志

完整说明见 [docs/gui-guide.md](./docs/gui-guide.md)。

本地开发运行：

```bash
cd gui
npm install
npm start
```

## CDN 与 manifest

CDN 当前承担两类职责：

1. 分发 `oclaw` CLI、GUI 安装程序和引导脚本
2. 提供 `manifest.json` 与 `cli-manifest.json`

其中：

- `manifest.json` 只标记当前最新 OpenClaw 版本
- `cli-manifest.json` 记录 `oclaw` CLI 的发布版本

不再存在 `pkg/{version}/openclaw-*` 这样的离线 OpenClaw 包目录。

更多细节见 [docs/deployment.md](./docs/deployment.md) 和 [cdn-template/README.md](./cdn-template/README.md)。

## 开发

目录结构：

```text
openclaw-install-cn/
├── cli/
├── gui/
├── scripts/
└── cdn-template/
```

运行 CLI 测试：

```bash
cd cli
npm install
npm test
```

运行 GUI 测试：

```bash
cd gui
npm test
```

依赖要求：

- Node.js >= 18
- npm >= 8
- PowerShell >= 5.1（Windows）

## License

MIT
