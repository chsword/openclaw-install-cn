#!/usr/bin/env bash
# ============================================================
# OpenClaw Installer Bootstrap – macOS / Linux
# ============================================================
# Usage:
#   curl -fsSL https://your-cdn.example.com/install.sh | bash
#   or
#   wget -qO- https://your-cdn.example.com/install.sh | bash
#
# The script will:
#   1. Check for Node.js (>=18); auto-installs Node.js LTS if absent
#   2. Download the oclaw CLI from CDN
#   3. Run `oclaw install` to install OpenClaw
#
# ── Offline / local bundle mode ──────────────────────────────
# Set OCLAW_LOCAL_BUNDLE to a local directory path to skip ALL
# network downloads.  Useful for air-gap environments or when
# you have a pre-downloaded "complete package".
#
# The directory must mirror the CDN structure:
#   {OCLAW_LOCAL_BUNDLE}/cli-manifest.json
#   {OCLAW_LOCAL_BUNDLE}/cli/{version}/oclaw-{version}-{os}-{arch}.tar.gz
#   {OCLAW_LOCAL_BUNDLE}/manifest.json
#   {OCLAW_LOCAL_BUNDLE}/{version}/openclaw-{version}-{os}-{arch}.tar.gz
#
# Example:
#   export OCLAW_LOCAL_BUNDLE=/mnt/usb/openclaw-bundle
#   bash install.sh
#
# ── Proxy / China mirror support ─────────────────────────────
# If you are behind a corporate firewall or in mainland China, set
# NODE_MIRROR before running the script to redirect Node.js downloads
# to a reachable mirror.
#
# Popular China mirrors:
#   export NODE_MIRROR=https://npmmirror.com/mirrors/node    # Alibaba/Taobao
#   export NODE_MIRROR=https://mirrors.huaweicloud.com/nodejs
#   export NODE_MIRROR=https://mirrors.aliyun.com/nodejs-release
#
# When using nvm, set NVM_NODEJS_ORG_MIRROR instead:
#   export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
# ============================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
CDN_BASE="${OCLAW_CDN:-https://openclaw-cdn.example.com}"
CLI_VERSION="${OCLAW_CLI_VERSION:-latest}"
INSTALL_DIR="${OCLAW_INSTALL_DIR:-$HOME/.openclaw}"
OCLAW_BIN_DIR="${OCLAW_BIN_DIR:-$HOME/.local/bin}"

# Set to a local directory to skip ALL network downloads (offline/air-gap mode).
OCLAW_LOCAL_BUNDLE="${OCLAW_LOCAL_BUNDLE:-}"

# Mirror for Node.js binary downloads.
# Override with a China mirror when nodejs.org is inaccessible:
#   export NODE_MIRROR=https://npmmirror.com/mirrors/node
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"

# Pin a specific Node.js version to install (e.g. "v20.19.1").
# Leave empty to auto-detect the latest LTS from NODE_MIRROR.
NODE_LTS_VERSION="${NODE_LTS_VERSION:-}"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✔${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✖${NC}  $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Fetch helper (stdout) ─────────────────────────────────────────────────────
# Usage: fetch <url>
fetch() {
  if command -v curl &>/dev/null; then
    curl -fsSL --max-time 30 "$1"
  elif command -v wget &>/dev/null; then
    wget -qO- --timeout=30 "$1"
  else
    die "Neither curl nor wget is available. Please install one and retry."
  fi
}

# ── Download helper (to file) ─────────────────────────────────────────────────
download() {
  local url="$1" dest="$2"
  if command -v curl &>/dev/null; then
    curl -fsSL --progress-bar -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -q --show-progress -O "$dest" "$url"
  else
    die "Neither curl nor wget is available. Please install one and retry."
  fi
}

# ── Resolve latest LTS version from mirror index ──────────────────────────────
# Outputs a full version string like "v20.19.1", or "v20" as fallback.
_resolve_lts_version() {
  local raw=""
  raw=$(fetch "${NODE_MIRROR%/}/index.json" 2>/dev/null || true)

  if [ -n "$raw" ]; then
    local ver=""

    # Try python3 first – handles both compact (single-line) and pretty-printed JSON.
    # isinstance check ensures we only match LTS entries (string codename), not "lts":false.
    if command -v python3 &>/dev/null; then
      ver=$(echo "$raw" | python3 -c \
        "import sys,json; d=json.load(sys.stdin); lts=[v for v in d if isinstance(v.get('lts'),str) and v.get('lts')]; print(lts[0]['version'] if lts else '')" \
        2>/dev/null || true)
    fi

    # Fallback: grep approach for one-object-per-line formats.
    # index.json is typically stored with each entry on its own line.
    # LTS entries have "lts":"<CodeName>" (non-empty string); non-LTS have "lts":false.
    if [ -z "$ver" ]; then
      ver=$(echo "$raw" | grep '"lts":"[^"]*"' | grep -v '"lts":""' | head -1 \
            | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi

    if [ -n "$ver" ]; then
      echo "$ver"; return
    fi
  fi

  warn "Could not detect Node.js LTS version from ${NODE_MIRROR}; falling back to v20."
  echo "v20"
}

# Given a major-only string like "v20", resolve to full "v20.x.y" by checking
# the mirror's latest-v20.x/ directory listing.
_resolve_major_to_full() {
  local major="${1#v}"
  local sums
  sums=$(fetch "${NODE_MIRROR%/}/latest-v${major}.x/SHASUMS256.txt" 2>/dev/null || true)
  if [ -n "$sums" ]; then
    echo "$sums" | head -1 | grep -o 'v[0-9][0-9.]*' | head -1
  fi
}

# ── Auto-install Node.js LTS ──────────────────────────────────────────────────
install_node_lts() {
  info "Node.js not found. Attempting automatic installation of Node.js LTS…"
  info "Mirror: ${NODE_MIRROR}"

  # ── Option 1: nvm (Node Version Manager) ─────────────────────────────────
  # Honour NVM_NODEJS_ORG_MIRROR for China users if set.
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    info "Found nvm – using it to install Node.js LTS."
    # shellcheck source=/dev/null
    . "$HOME/.nvm/nvm.sh"
    # Allow nvm to use our mirror if the user hasn't set its own
    export NVM_NODEJS_ORG_MIRROR="${NVM_NODEJS_ORG_MIRROR:-$NODE_MIRROR}"
    nvm install --lts
    nvm use --lts
    success "Node.js $(node --version) installed via nvm."
    return
  fi

  # ── Option 2: download precompiled binary tarball ────────────────────────
  local target_ver="${NODE_LTS_VERSION}"

  if [ -z "$target_ver" ]; then
    info "Detecting latest Node.js LTS version from ${NODE_MIRROR}…"
    target_ver=$(_resolve_lts_version)
    info "Resolved LTS: $target_ver"
  fi

  # Expand "v20" → "v20.x.y" using the mirror's latest-v20.x directory
  if echo "$target_ver" | grep -qE '^v[0-9]+$'; then
    local full
    full=$(_resolve_major_to_full "$target_ver")
    if [ -n "$full" ]; then
      target_ver="$full"
      info "Expanded to full version: $target_ver"
    fi
  fi

  local os_type arch_type pkg_name
  os_type=$(uname -s)
  arch_type=$(uname -m)
  case "$arch_type" in
    x86_64)         arch_type="x64"    ;;
    aarch64|arm64)  arch_type="arm64"  ;;
    armv7l)         arch_type="armv7l" ;;
    *)              arch_type="x64"    ;;
  esac
  case "$os_type" in
    Linux)   pkg_name="node-${target_ver}-linux-${arch_type}.tar.gz"  ;;
    Darwin)  pkg_name="node-${target_ver}-darwin-${arch_type}.tar.gz" ;;
    *)
      die "Unsupported OS '${os_type}' for automatic Node.js install. \
Please install Node.js >= 18 manually from https://nodejs.org/ and re-run."
      ;;
  esac

  local pkg_url="${NODE_MIRROR%/}/${target_ver}/${pkg_name}"
  local node_lib_dir="$HOME/.local/lib/nodejs"
  local node_bin_dir="$HOME/.local/bin"
  local node_tmp
  node_tmp=$(mktemp -d)

  info "Downloading ${pkg_name} …"
  if ! download "$pkg_url" "${node_tmp}/${pkg_name}"; then
    rm -rf "$node_tmp"
    die "Failed to download Node.js from ${pkg_url}.
  → Set NODE_MIRROR to a reachable mirror and retry, e.g.:
      export NODE_MIRROR=https://npmmirror.com/mirrors/node"
  fi

  info "Extracting Node.js ${target_ver} …"
  mkdir -p "$node_lib_dir"
  tar -xzf "${node_tmp}/${pkg_name}" -C "$node_lib_dir"
  rm -rf "$node_tmp"

  local node_dir="${node_lib_dir}/node-${target_ver}-$(echo "$os_type" | tr '[:upper:]' '[:lower:]')-${arch_type}"
  # Resolve exact extracted directory name (handles case differences)
  if [ ! -d "$node_dir" ]; then
    node_dir=$(find "$node_lib_dir" -maxdepth 1 -type d -name "node-${target_ver}*" | head -1)
  fi

  if [ -z "$node_dir" ] || [ ! -d "$node_dir" ]; then
    die "Could not locate extracted Node.js directory in ${node_lib_dir}."
  fi

  mkdir -p "$node_bin_dir"
  for bin in node npm npx; do
    local bin_src="${node_dir}/bin/${bin}"
    if [ -f "$bin_src" ]; then
      ln -sf "$bin_src" "${node_bin_dir}/${bin}"
    fi
  done

  # Make Node.js available for the rest of this script
  export PATH="${node_bin_dir}:${PATH}"

  success "Node.js $(node --version) installed to ${node_dir}"
  warn "To make Node.js permanently available, add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
}

# ── Check Node.js (auto-install if missing) ───────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    install_node_lts
  fi

  local node_ver major
  node_ver=$(node -e "process.stdout.write(process.versions.node)")
  major=$(echo "$node_ver" | cut -d. -f1)

  if [ "$major" -lt 18 ]; then
    warn "Node.js ${node_ver} is too old (need >= 18). Attempting upgrade…"
    install_node_lts
    node_ver=$(node -e "process.stdout.write(process.versions.node)" 2>/dev/null || true)
    major=$(echo "$node_ver" | cut -d. -f1)
    if [ "$major" -lt 18 ]; then
      die "Node.js >= 18 is required but installation produced ${node_ver}. \
Please upgrade manually from https://nodejs.org/ and re-run."
    fi
  fi

  success "Node.js ${node_ver} detected."
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║      OpenClaw Installer Bootstrap    ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

  if [ -n "$OCLAW_LOCAL_BUNDLE" ]; then
    _install_from_local_bundle
  else
    _install_from_cdn
  fi
}

# ── Online CDN install ────────────────────────────────────────────────────────
_install_from_cdn() {
  check_node

  # Create bin dir
  mkdir -p "$OCLAW_BIN_DIR"

  # Determine CLI package URL
  local os_name arch_name
  os_name=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch_name=$(uname -m)
  case "$arch_name" in
    x86_64)  arch_name="x64"   ;;
    aarch64) arch_name="arm64" ;;
    arm64)   arch_name="arm64" ;;
    *)       warn "Unknown arch $arch_name, defaulting to x64"; arch_name="x64" ;;
  esac

  # Resolve CLI version
  local cli_ver="$CLI_VERSION"
  if [ "$cli_ver" = "latest" ]; then
    info "Fetching latest CLI version…"
    cli_ver=$(fetch "$CDN_BASE/cli-manifest.json" \
      | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).latest))")
    info "Latest CLI version: $cli_ver"
  fi

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  local pkg_name="oclaw-${cli_ver}-${os_name}-${arch_name}.tar.gz"
  local pkg_url="$CDN_BASE/cli/${cli_ver}/${pkg_name}"
  local pkg_path="$tmp_dir/$pkg_name"

  info "Downloading oclaw CLI $cli_ver…"
  download "$pkg_url" "$pkg_path"

  info "Extracting…"
  tar -xzf "$pkg_path" -C "$tmp_dir"

  # Install CLI binary
  local bin_src="$tmp_dir/oclaw"
  [ -f "$bin_src" ] || bin_src="$tmp_dir/bin/oclaw"
  [ -f "$bin_src" ] || die "Could not find oclaw binary in downloaded package."

  chmod +x "$bin_src"
  cp "$bin_src" "$OCLAW_BIN_DIR/oclaw"
  success "oclaw CLI installed to $OCLAW_BIN_DIR/oclaw"

  # Set CDN in config
  "$OCLAW_BIN_DIR/oclaw" config --cdn-url "$CDN_BASE" || true

  # Install OpenClaw
  info "Installing OpenClaw from CDN ($CDN_BASE)…"
  "$OCLAW_BIN_DIR/oclaw" install --dir "$INSTALL_DIR"

  echo ""
  success "OpenClaw installed successfully!"
  echo ""

  # PATH hint
  case ":${PATH}:" in
    *":$OCLAW_BIN_DIR:"*) ;;
    *)
      echo -e "  ${YELLOW}Add oclaw to your PATH by adding the following to your shell profile:${NC}"
      echo ""
      echo "    export PATH=\"\$PATH:$OCLAW_BIN_DIR\""
      echo ""
      ;;
  esac
}

# ── Offline local bundle install ──────────────────────────────────────────────
# Uses a pre-downloaded bundle directory instead of fetching from the internet.
_install_from_local_bundle() {
  local bundle
  bundle=$(cd "$OCLAW_LOCAL_BUNDLE" 2>/dev/null && pwd) \
    || die "Local bundle directory not found: $OCLAW_LOCAL_BUNDLE"

  info "Offline mode: using local bundle at $bundle"

  # Node.js is still required to run the oclaw CLI (unless using a standalone binary).
  # In local bundle mode we do NOT auto-install Node.js from the internet.
  if ! command -v node &>/dev/null; then
    die "Node.js is required but not found.
  In offline mode, please install Node.js >= 18 manually before running this script.
  Download Node.js from a mirror you have access to, e.g.:
    https://npmmirror.com/mirrors/node"
  fi

  local node_ver major
  node_ver=$(node -e "process.stdout.write(process.versions.node)")
  major=$(echo "$node_ver" | cut -d. -f1)
  if [ "$major" -lt 18 ]; then
    die "Node.js ${node_ver} is too old (need >= 18). Please upgrade manually and retry."
  fi
  success "Node.js ${node_ver} detected."

  mkdir -p "$OCLAW_BIN_DIR"

  # Determine platform identifiers
  local os_name arch_name
  os_name=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch_name=$(uname -m)
  case "$arch_name" in
    x86_64)  arch_name="x64"   ;;
    aarch64) arch_name="arm64" ;;
    arm64)   arch_name="arm64" ;;
    *)       warn "Unknown arch $arch_name, defaulting to x64"; arch_name="x64" ;;
  esac

  # Resolve CLI version from local cli-manifest.json
  local cli_manifest="$bundle/cli-manifest.json"
  [ -f "$cli_manifest" ] || die "cli-manifest.json not found in bundle: $bundle"

  local cli_ver
  cli_ver=$(node -e "process.stdout.write(require('$cli_manifest').latest)" 2>/dev/null) \
    || die "Could not read CLI version from $cli_manifest"
  info "CLI version from local bundle: $cli_ver"

  # Locate CLI archive in bundle
  local cli_pkg_name="oclaw-${cli_ver}-${os_name}-${arch_name}.tar.gz"
  local cli_pkg_path="$bundle/cli/${cli_ver}/${cli_pkg_name}"
  [ -f "$cli_pkg_path" ] \
    || die "CLI package not found in bundle: $cli_pkg_path"

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  info "Extracting oclaw CLI from local bundle…"
  tar -xzf "$cli_pkg_path" -C "$tmp_dir"

  local bin_src="$tmp_dir/oclaw"
  [ -f "$bin_src" ] || bin_src="$tmp_dir/bin/oclaw"
  [ -f "$bin_src" ] || die "Could not find oclaw binary in CLI package."

  chmod +x "$bin_src"
  cp "$bin_src" "$OCLAW_BIN_DIR/oclaw"
  success "oclaw CLI installed to $OCLAW_BIN_DIR/oclaw"

  # Install OpenClaw from local bundle
  info "Installing OpenClaw from local bundle…"
  "$OCLAW_BIN_DIR/oclaw" install --dir "$INSTALL_DIR" --local-package "$bundle"

  echo ""
  success "OpenClaw installed successfully!"
  echo ""

  # PATH hint
  case ":${PATH}:" in
    *":$OCLAW_BIN_DIR:"*) ;;
    *)
      echo -e "  ${YELLOW}Add oclaw to your PATH by adding the following to your shell profile:${NC}"
      echo ""
      echo "    export PATH=\"\$PATH:$OCLAW_BIN_DIR\""
      echo ""
      ;;
  esac
}

main "$@"
