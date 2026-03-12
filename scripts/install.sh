#!/usr/bin/env bash

set -euo pipefail

NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
NVM_MIRROR="${NVM_MIRROR:-https://github.com/nvm-sh/nvm}"
NODE_VERSION="${NODE_VERSION:-lts/*}"
INSTALL_COMMAND='pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com'
LOG_FILE="${OCLAW_LOG_FILE:-$(mktemp /tmp/openclaw-install-XXXXXXXXXX.log 2>/dev/null || echo "/tmp/openclaw-install-$$.log") }"
AUTO_INSTALL=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_line() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null || true; }
info() { echo -e "${CYAN}ℹ${NC}  $*"; log_line "[INFO] $*"; }
success() { echo -e "${GREEN}✔${NC}  $*"; log_line "[SUCCESS] $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; log_line "[WARN] $*"; }
die() { echo -e "${RED}✖${NC}  $*" >&2; log_line "[ERROR] $*"; echo "  Log file: $LOG_FILE" >&2; exit 1; }

parse_version() {
  local output
  output="$($@ 2>/dev/null || true)"
  if [ -z "$output" ]; then
    return 1
  fi
  echo "$output" | grep -oE 'v?[0-9]+(\.[0-9]+)+' | head -1 | sed 's/^v//'
}

install_node_via_nvm() {
  info '正在通过 nvm 安装 Node.js...'

  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  local nvm_install_url

  # Use NVM_MIRROR if set to a non-empty, non-default value, otherwise use the raw install script
  if [ -n "${NVM_MIRROR}" ] && [ "${NVM_MIRROR}" != 'https://github.com/nvm-sh/nvm' ]; then
    nvm_install_url="${NVM_MIRROR}/install.sh"
  else
    nvm_install_url='https://raw.githubusercontent.com/nvm-sh/nvm/HEAD/install.sh'
  fi

  info "下载 nvm 安装脚本：$nvm_install_url"
  if command -v curl >/dev/null 2>&1; then
    NVM_DIR="$nvm_dir" NODEJS_ORG_MIRROR="$NODE_MIRROR" \
      curl -fsSL "$nvm_install_url" | bash \
      || die 'nvm 安装失败。请手动安装 Node.js：'"$NODE_MIRROR"
  elif command -v wget >/dev/null 2>&1; then
    NVM_DIR="$nvm_dir" NODEJS_ORG_MIRROR="$NODE_MIRROR" \
      wget -qO- "$nvm_install_url" | bash \
      || die 'nvm 安装失败。请手动安装 Node.js：'"$NODE_MIRROR"
  else
    die '未找到 curl 或 wget，无法自动安装 Node.js。请手动安装后重试。'
  fi

  # Source nvm into the current shell
  # shellcheck source=/dev/null
  [ -s "$nvm_dir/nvm.sh" ] && \. "$nvm_dir/nvm.sh"

  if ! type nvm >/dev/null 2>&1; then
    die 'nvm 安装完成，但当前 shell 无法加载 nvm。请重新打开终端后重试。'
  fi

  info "正在安装 Node.js（$NODE_VERSION）..."
  NODEJS_ORG_MIRROR="$NODE_MIRROR" nvm install "$NODE_VERSION" \
    || die "Node.js 安装失败。请访问 $NODE_MIRROR 手动安装。"

  nvm use "$NODE_VERSION" 2>/dev/null || true

  local node_ver
  node_ver=$(parse_version node --version) || die 'Node.js 安装后仍无法获取版本信息。'
  success "Node.js $node_ver 已通过 nvm 安装成功。"
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    warn "未检测到 Node.js。"

    local do_install=false
    if [ "$AUTO_INSTALL" = true ]; then
      do_install=true
    elif [ -t 0 ]; then
      printf "${CYAN}ℹ${NC}  是否自动安装 Node.js（通过 nvm）？[Y/n] "
      local answer
      read -r answer
      case "$answer" in
        ''|[Yy]*) do_install=true ;;
        *) die "请先手动安装 Node.js 18 或更高版本后再重试。推荐镜像：$NODE_MIRROR" ;;
      esac
    else
      die "未检测到 Node.js。请先安装 Node.js 18 或更高版本，或使用 -y 参数启用自动安装。推荐镜像：$NODE_MIRROR"
    fi

    if [ "$do_install" = true ]; then
      install_node_via_nvm
    fi
  fi

  local node_ver
  node_ver=$(parse_version node --version) || die '无法获取 Node.js 版本。'
  local major
  major=$(echo "$node_ver" | cut -d. -f1)
  if [ "$major" -lt 18 ]; then
    die "当前 Node.js 版本为 $node_ver，需要 18 或更高版本。"
  fi

  success "Node.js $node_ver 已就绪。"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    local pnpm_ver
    pnpm_ver=$(parse_version pnpm --version || true)
    success "pnpm ${pnpm_ver:-unknown} 已就绪。"
    return
  fi

  info '未检测到 pnpm，正在通过 npm 安装...'
  npm install -g pnpm || die 'pnpm 安装失败，请先执行 npm install -g pnpm。'

  if ! command -v pnpm >/dev/null 2>&1; then
    die 'pnpm 安装完成，但当前终端仍无法识别 pnpm。请重新打开终端后重试。'
  fi

  local pnpm_ver
  pnpm_ver=$(parse_version pnpm --version || true)
  success "pnpm ${pnpm_ver:-unknown} 已安装。"
}

install_openclaw() {
  local current=''
  if command -v openclaw >/dev/null 2>&1; then
    current=$(parse_version openclaw --version || true)
  fi

  if [ -n "$current" ]; then
    info "检测到当前 OpenClaw 版本：$current"
  else
    info '当前未检测到 OpenClaw，将执行全新安装。'
  fi

  info "执行命令：$INSTALL_COMMAND"
  pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com || die 'OpenClaw 安装失败。'

  if ! command -v openclaw >/dev/null 2>&1; then
    die '安装完成，但当前终端仍无法识别 openclaw 命令。请确认 pnpm 全局目录已加入 PATH。'
  fi

  local installed
  installed=$(parse_version openclaw --version || true)
  success "OpenClaw ${installed:-unknown} 安装成功。"
}

main() {
  # Parse flags
  for arg in "$@"; do
    case "$arg" in
      -y|--auto-install) AUTO_INSTALL=true ;;
    esac
  done

  : > "$LOG_FILE" 2>/dev/null || true
  info '开始检查安装环境...'
  check_node
  ensure_pnpm
  install_openclaw
  echo
  success '全部完成。'
  echo "  Log file: $LOG_FILE"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
