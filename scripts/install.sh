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
#   1. Check for Node.js (>=18) – installation instructions if missing
#   2. Download the oclaw CLI from CDN
#   3. Run `oclaw install` to install OpenClaw
# ============================================================

set -euo pipefail

CDN_BASE="${OCLAW_CDN:-https://openclaw-cdn.example.com}"
CLI_VERSION="${OCLAW_CLI_VERSION:-latest}"
INSTALL_DIR="${OCLAW_INSTALL_DIR:-$HOME/.openclaw}"
OCLAW_BIN_DIR="${OCLAW_BIN_DIR:-$HOME/.local/bin}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✔${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✖${NC}  $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Check Node.js ────────────────────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    die "Node.js is not installed. Please install Node.js >= 18 from https://nodejs.org/ and re-run this script."
  fi
  local node_ver
  node_ver=$(node -e "process.stdout.write(process.versions.node)")
  local major
  major=$(echo "$node_ver" | cut -d. -f1)
  if [ "$major" -lt 18 ]; then
    die "Node.js >= 18 is required (found $node_ver). Please upgrade."
  fi
  success "Node.js $node_ver detected."
}

# ── Download helper ──────────────────────────────────────────────────────────
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

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║      OpenClaw Installer Bootstrap    ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

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
    if command -v curl &>/dev/null; then
      cli_ver=$(curl -fsSL "$CDN_BASE/cli-manifest.json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).latest))")
    else
      cli_ver=$(wget -qO- "$CDN_BASE/cli-manifest.json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).latest))")
    fi
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

main "$@"
