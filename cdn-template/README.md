# CDN 目录结构模板 / CDN Directory Structure Template

将以下文件上传到您的 CDN（如腾讯云 COS）：

```
(CDN Root)/
├── manifest.json          # OpenClaw 包版本清单
├── cli-manifest.json      # oclaw CLI 版本清单
│
├── 1.0.0/                 # OpenClaw v1.0.0 包目录
│   ├── openclaw-1.0.0-win32-x64.zip
│   ├── openclaw-1.0.0-darwin-x64.tar.gz
│   ├── openclaw-1.0.0-darwin-arm64.tar.gz
│   └── openclaw-1.0.0-linux-x64.tar.gz
│
├── cli/                   # oclaw CLI 包目录
│   └── 1.0.0/
│       ├── oclaw-1.0.0-win32-x64.zip
│       ├── oclaw-1.0.0-darwin-x64.tar.gz
│       ├── oclaw-1.0.0-darwin-arm64.tar.gz
│       └── oclaw-1.0.0-linux-x64.tar.gz
│
├── install.sh             # macOS/Linux 一键安装脚本
└── install.ps1            # Windows 一键安装脚本
```

## manifest.json 格式说明

```json
{
  "latest": "1.0.0",       // 最新版本号
  "versions": [
    {
      "version": "1.0.0",
      "releaseDate": "2025-01-01",
      "description": "版本说明",
      "files": {
        "win32-x64":    "openclaw-1.0.0-win32-x64.zip",
        "darwin-x64":   "openclaw-1.0.0-darwin-x64.tar.gz",
        "darwin-arm64": "openclaw-1.0.0-darwin-arm64.tar.gz",
        "linux-x64":    "openclaw-1.0.0-linux-x64.tar.gz"
      },
      "checksums": {
        "win32-x64":    "sha256:abc123...",
        ...
      }
    }
  ]
}
```

## 发布新版本步骤

1. 从 [openclaw.ai](https://openclaw.ai) 下载各平台的 OpenClaw 安装包
2. 将包重命名为 `openclaw-{version}-{platform}-{arch}.{ext}` 格式
3. 上传到 CDN 的 `{version}/` 目录
4. 更新 `manifest.json` 中的 `latest` 字段和 `versions` 数组
5. 用户运行 `oclaw upgrade` 即可自动获取更新

## 腾讯云 COS 配置建议

- Bucket 设置为公有读（或配置 CDN 访问控制）
- 开启 CDN 加速，设置合理的缓存时间（manifest.json 短缓存，包文件长缓存）
- 建议为 `manifest.json` 和 `cli-manifest.json` 设置 `Cache-Control: max-age=60`
- 建议为包文件设置 `Cache-Control: max-age=86400`
