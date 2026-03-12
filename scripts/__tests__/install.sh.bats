#!/usr/bin/env bats
# Unit tests for scripts/install.sh
# Requires bats-core: https://github.com/bats-core/bats-core

SCRIPT="${BATS_TEST_DIRNAME}/../install.sh"

# Minimal safe PATH: mock bin first, then essential system utilities only.
# This prevents tests from accidentally finding real node/pnpm/npm/openclaw.
SAFE_SYSTEM_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

setup() {
  TEST_TMPDIR="$(mktemp -d)"
  export OCLAW_LOG_FILE="${TEST_TMPDIR}/test.log"
  MOCK_BIN="${TEST_TMPDIR}/bin"
  mkdir -p "${MOCK_BIN}"
}

teardown() {
  rm -rf "${TEST_TMPDIR}"
}

# Create a mock executable in MOCK_BIN.
_make_mock() {
  local name="$1" body="$2"
  printf '#!/bin/sh\n%s\n' "${body}" > "${MOCK_BIN}/${name}"
  chmod +x "${MOCK_BIN}/${name}"
}

# Source the script with a controlled PATH so real tools are not accidentally
# found. Disables strict mode afterwards so test assertions can use || / &&
# freely without aborting the test subshell on non-zero exit.
_load() {
  export PATH="${MOCK_BIN}:${SAFE_SYSTEM_PATH}"
  # shellcheck disable=SC1090
  source "${SCRIPT}"
  set +euo pipefail
}

# ── parse_version ─────────────────────────────────────────────────────────────

@test "parse_version: extracts semver from v-prefixed output" {
  _load
  result="$(parse_version echo 'v20.11.0')"
  [ "${result}" = "20.11.0" ]
}

@test "parse_version: strips leading v" {
  _load
  result="$(parse_version echo 'v18.0.0')"
  [ "${result}" = "18.0.0" ]
}

@test "parse_version: returns failure for empty output" {
  _load
  run parse_version true
  [ "${status}" -ne 0 ]
}

@test "parse_version: handles version embedded in longer string" {
  _load
  result="$(parse_version echo 'npm version 10.2.0 (some extra text)')"
  [ "${result}" = "10.2.0" ]
}

# ── check_node ────────────────────────────────────────────────────────────────

@test "check_node: succeeds when node 18 is present" {
  _make_mock node 'echo v18.0.0'
  _load
  run check_node
  [ "${status}" -eq 0 ]
}

@test "check_node: succeeds when node 22 is present" {
  _make_mock node 'echo v22.1.0'
  _load
  run check_node
  [ "${status}" -eq 0 ]
}

@test "check_node: fails when node version is below 18" {
  _make_mock node 'echo v16.20.2'
  _load
  run check_node
  [ "${status}" -ne 0 ]
}

@test "check_node: fails non-interactively when node is absent and AUTO_INSTALL=false" {
  # No node mock → command -v node fails; stdin is not a tty in CI
  _load
  AUTO_INSTALL=false
  run check_node
  [ "${status}" -ne 0 ]
}

@test "check_node: auto-installs node when AUTO_INSTALL=true" {
  # node absent initially; install_node_via_nvm is overridden to materialise the mock
  _load
  AUTO_INSTALL=true
  # Override nvm installer to create a mock node instead of actually calling nvm
  install_node_via_nvm() {
    _make_mock node 'echo v18.0.0'
  }
  run check_node
  [ "${status}" -eq 0 ]
}

# ── ensure_pnpm ───────────────────────────────────────────────────────────────

@test "ensure_pnpm: succeeds when pnpm is already installed" {
  _make_mock pnpm 'echo 9.0.0'
  _load
  run ensure_pnpm
  [ "${status}" -eq 0 ]
}

@test "ensure_pnpm: fails when npm returns non-zero and pnpm is absent" {
  _make_mock npm 'exit 1'
  # No pnpm mock → command -v pnpm fails; mock npm exits 1
  _load
  run ensure_pnpm
  [ "${status}" -ne 0 ]
}

# ── install_openclaw ──────────────────────────────────────────────────────────

@test "install_openclaw: succeeds when pnpm exits 0 and openclaw is available" {
  _make_mock pnpm 'exit 0'
  _make_mock openclaw 'echo 1.0.25'
  _load
  run install_openclaw
  [ "${status}" -eq 0 ]
}

@test "install_openclaw: fails when pnpm exits non-zero" {
  _make_mock pnpm 'exit 1'
  _load
  run install_openclaw
  [ "${status}" -ne 0 ]
}

@test "install_openclaw: fails when openclaw not found after install" {
  _make_mock pnpm 'exit 0'
  # No openclaw mock → command -v openclaw fails after pnpm install
  _load
  run install_openclaw
  [ "${status}" -ne 0 ]
}

# ── full-script integration (end-to-end with mocks) ───────────────────────────

@test "full script: exits 0 with -y when all tools are available" {
  _make_mock node 'echo v20.0.0'
  _make_mock pnpm 'printf "8.0.0\n"'
  _make_mock openclaw 'echo 1.0.0'
  run env PATH="${MOCK_BIN}:${SAFE_SYSTEM_PATH}" \
    OCLAW_LOG_FILE="${OCLAW_LOG_FILE}" \
    bash "${SCRIPT}" -y
  [ "${status}" -eq 0 ]
}

@test "full script: exits 0 with --auto-install when all tools are available" {
  _make_mock node 'echo v20.0.0'
  _make_mock pnpm 'printf "8.0.0\n"'
  _make_mock openclaw 'echo 1.0.0'
  run env PATH="${MOCK_BIN}:${SAFE_SYSTEM_PATH}" \
    OCLAW_LOG_FILE="${OCLAW_LOG_FILE}" \
    bash "${SCRIPT}" --auto-install
  [ "${status}" -eq 0 ]
}

@test "full script: exits non-zero when node is absent and no AUTO_INSTALL flag" {
  # No node mock; pass empty stdin so check_node takes the non-interactive path
  run env PATH="${MOCK_BIN}:${SAFE_SYSTEM_PATH}" \
    OCLAW_LOG_FILE="${OCLAW_LOG_FILE}" \
    bash "${SCRIPT}" < /dev/null
  [ "${status}" -ne 0 ]
}
