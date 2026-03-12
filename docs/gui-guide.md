# GUI 使用说明 / GUI User Guide

本文档说明如何使用 OpenClaw 图形界面完成环境检查、安装、升级和日志查看。

## 1. 获取 GUI

推荐从 GitHub Releases 下载最新 GUI 安装包，也可以从源码运行：

```bash
git clone https://github.com/chsword/openclaw-install-cn.git
cd openclaw-install-cn/gui
npm install
npm start
```

## 2. 界面概览

GUI 当前围绕“前置环境检查 + pnpm 安装”设计，主界面会显示：

- 当前 OpenClaw 版本
- 最新 OpenClaw 版本
- Node.js 状态
- pnpm 状态
- 当前系统平台
- 实际执行的安装命令

安装命令固定为：

```bash
pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
```

## 3. 首次安装

点击“安装 / 升级”后，GUI 会依次执行：

1. 检查是否已安装 Node.js，且主版本不低于 18
2. 检查是否已安装 pnpm
3. 检查当前是否已安装 OpenClaw
4. 查询最新版本信息
5. 调用 pnpm 执行全局安装

如果缺少 Node.js 或 pnpm，界面会优先提示先补齐运行环境。

## 4. 检查更新与升级

点击“检查更新”后，GUI 会读取 manifest 中标记的最新 OpenClaw 版本，并与本机 `openclaw --version` 的结果对比。

如果发现有新版本，界面会提示可以升级；升级按钮实际执行的仍然是同一条 pnpm 命令，由 pnpm 决定安装或更新。

## 5. 日志查看

GUI 保留日志面板，用于查看安装检查、版本检查和执行命令时的输出。

常见日志内容包括：

- Node.js 检测结果
- pnpm 检测结果
- 当前 OpenClaw 版本
- 最新版本查询结果
- 安装命令执行结果

## 6. 常见问题

### Q：界面提示缺少 Node.js

先安装 Node.js 18 或更高版本，再重新打开 GUI。

### Q：界面提示缺少 pnpm

可以先执行：

```bash
npm install -g pnpm
```

安装完成后重新打开 GUI。

### Q：点击安装后没有成功

优先检查：

1. Node.js 是否可用
2. pnpm 是否可用
3. 当前网络是否能访问 `https://registry.npmmirror.com`
4. 日志面板中是否有命令执行错误

### Q：最新版本从哪里来

GUI 读取 CDN 上的 `manifest.json`。该文件现在只用于标记当前最新 OpenClaw 版本，不再包含各平台离线安装包列表。

## 相关文档

- [README](../README.md)
- [部署指南](deployment.md)
- [CDN 模板说明](../cdn-template/README.md)
