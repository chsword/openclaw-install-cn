#Requires -Version 5.1
<#
.SYNOPSIS
  OpenClaw Bootstrap Installer for Windows
.DESCRIPTION
  Verifies Node.js and pnpm, then installs or upgrades OpenClaw with pnpm.
  Actual install command:
    pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
.PARAMETER NodeMirror
  Reserved for Node.js installation guidance. Example mirrors:
    https://npmmirror.com/mirrors/node
    https://mirrors.huaweicloud.com/nodejs
.PARAMETER LogFile
  Path to the installation log file.
#>
[CmdletBinding()]
param(
  [string]$NodeMirror = $(if ($env:NODE_MIRROR) { $env:NODE_MIRROR } else { 'https://nodejs.org/dist' }),
  [string]$LogFile = $(if ($env:OCLAW_LOG_FILE) { $env:OCLAW_LOG_FILE } else { Join-Path $env:TEMP "openclaw-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log" })
)

$script:InstallCommand = 'pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com'

function Write-LogLine {
  param([string]$Level, [string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$Level] $Message"
  Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Write-Info { param([string]$Message) Write-Host "  [i] $Message" -ForegroundColor Cyan; Write-LogLine 'INFO' $Message }
function Write-Success { param([string]$Message) Write-Host "  [✔] $Message" -ForegroundColor Green; Write-LogLine 'SUCCESS' $Message }
function Write-Warn { param([string]$Message) Write-Host "  [!] $Message" -ForegroundColor Yellow; Write-LogLine 'WARN' $Message }
function Write-Fail { param([string]$Message) Write-Host "  [✖] $Message" -ForegroundColor Red; Write-LogLine 'ERROR' $Message; throw $Message }

function Get-Version {
  param([string]$Command, [string[]]$Args)
  try {
    $output = & $Command @Args 2>$null
    if (-not $output) { return $null }
    $match = [regex]::Match(($output | Out-String), 'v?(\d+(?:\.\d+)+)')
    if ($match.Success) { return $match.Groups[1].Value }
    return ($output | Select-Object -First 1).ToString().Trim()
  } catch {
    return $null
  }
}

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Fail "未检测到 Node.js。请先安装 Node.js 18 或更高版本。推荐镜像：$NodeMirror"
  }

  $version = Get-Version 'node' @('--version')
  if (-not $version) {
    Write-Fail '无法获取 Node.js 版本。'
  }

  $major = [int](($version -split '\.')[0])
  if ($major -lt 18) {
    Write-Fail "当前 Node.js 版本为 $version，需要 18 或更高版本。"
  }

  Write-Success "Node.js $version 已就绪。"
}

function Ensure-Pnpm {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpm) {
    $version = Get-Version 'pnpm' @('--version')
    Write-Success "pnpm $version 已就绪。"
    return
  }

  Write-Info '未检测到 pnpm，正在通过 npm 安装...'
  & npm install -g pnpm
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'pnpm 安装失败，请先执行 npm install -g pnpm。'
  }

  $version = Get-Version 'pnpm' @('--version')
  if (-not $version) {
    Write-Fail 'pnpm 安装完成，但当前终端无法识别 pnpm。请重新打开终端后重试。'
  }

  Write-Success "pnpm $version 已安装。"
}

function Get-OpenClawVersion {
  return Get-Version 'openclaw' @('--version')
}

function Install-OpenClaw {
  $current = Get-OpenClawVersion
  if ($current) {
    Write-Info "检测到当前 OpenClaw 版本：$current"
  } else {
    Write-Info '当前未检测到 OpenClaw，将执行全新安装。'
  }

  Write-Info "执行命令：$script:InstallCommand"
  & pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'OpenClaw 安装失败。'
  }

  $installed = Get-OpenClawVersion
  if (-not $installed) {
    Write-Fail '安装完成，但当前终端仍无法识别 openclaw 命令。请确认 pnpm 全局目录已加入 PATH。'
  }

  Write-Success "OpenClaw $installed 安装成功。"
}

try {
  New-Item -ItemType File -Path $LogFile -Force | Out-Null
  Write-Info '开始检查安装环境...'
  Test-Node
  Ensure-Pnpm
  Install-OpenClaw
  Write-Host ''
  Write-Success '全部完成。'
  Write-Host "  日志文件: $LogFile" -ForegroundColor DarkGray
} catch {
  Write-Host ''
  Write-Host "  安装失败: $_" -ForegroundColor Red
  Write-Host "  日志文件: $LogFile" -ForegroundColor Yellow
  exit 1
}
