#!/usr/bin/env bash
# Platform detection, the prerequisite check, and installing what is missing.
# Sourced by daedalus.sh after common.sh, for `doctor` and `setup`.
#
#   detect_platform   OS, arch, WSL, package manager → PLATFORM_* variables
#   doctor_check      one table: every prerequisite, found or not, and its fix
#   doctor_install    offer to install each missing tool, asking first
#
# Installs only ever run after a yes (or --yes), and say when they use sudo.
# macOS uses Homebrew; Linux apt, dnf or pacman; Node comes from nvm when it is
# missing or too old, pnpm from corepack. Native Windows has no bash: use
# daedalus.ps1, which sets up WSL and hands over to this script.

MIN_PYTHON="3.11"
MIN_NODE="20"
NVM_VERSION="v0.40.1"
NODE_VERSION="22"

# ── platform ─────────────────────────────────────────────────────────────────
detect_platform() {
  PLATFORM_ARCH="$(uname -m)"
  case "$PLATFORM_ARCH" in x86_64|amd64) PLATFORM_ARCH="x64" ;; aarch64|arm64) PLATFORM_ARCH="arm64" ;; esac
  PLATFORM_WSL=0
  case "$(uname -s)" in
    Darwin) PLATFORM_OS="macos"; PLATFORM_NAME="macOS $(sw_vers -productVersion 2>/dev/null)" ;;
    Linux)
      PLATFORM_OS="linux"
      PLATFORM_NAME="$( (. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-Linux}") || echo Linux)"
      grep -qi microsoft /proc/version 2>/dev/null && PLATFORM_WSL=1 ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_OS="windows"; PLATFORM_NAME="Windows (Git Bash)" ;;
    *) PLATFORM_OS="unknown"; PLATFORM_NAME="$(uname -s)" ;;
  esac
  PLATFORM_PKG=""
  if [ "$PLATFORM_OS" = "macos" ]; then have brew && PLATFORM_PKG="brew"
  else for p in apt-get dnf pacman; do have "$p" && { PLATFORM_PKG="$p"; break; }; done; fi
  return 0                                  # "no package manager" is an answer, not a failure
}

platform_line() {
  local wsl=""; [ "$PLATFORM_WSL" = 1 ] && wsl=" · WSL"
  printf '%s · %s%s · %s' "$PLATFORM_NAME" "$PLATFORM_ARCH" "$wsl" "${PLATFORM_PKG:-no package manager found}"
}

# The command that installs one system package here, or empty if unknown.
pkg_install_cmd() {
  case "$PLATFORM_PKG" in
    brew)    printf 'brew install %s' "$1" ;;
    apt-get) printf 'sudo apt-get update && sudo apt-get install -y %s' "$1" ;;
    dnf)     printf 'sudo dnf install -y %s' "$1" ;;
    pacman)  printf 'sudo pacman -S --noconfirm %s' "$1" ;;
  esac
}

# version_ge 3.12.1 3.11 → true
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# nvm only reaches PATH in interactive shells (it lives in ~/.bashrc), so a
# shell started by `wsl.exe`, cron or an IDE finds the system node instead.
# When that one is missing or too old and nvm is installed, use nvm's default.
use_nvm_node() {
  if have node && version_ge "$(node --version 2>/dev/null | tr -d v)" "$MIN_NODE"; then return 0; fi
  local dir="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$dir/nvm.sh" ] || return 0
  set +u                                    # nvm reads unset variables
  export NVM_DIR="$dir"; . "$NVM_DIR/nvm.sh" --no-use; nvm use default >/dev/null 2>&1 || true
  set -u
  hash -r
}

# ── the check ────────────────────────────────────────────────────────────────
# One row per item: name, state (ok | missing | old | warn | info), what was
# found, and the install command for `doctor_install` (empty = none offered).
ROW_NAME=(); ROW_STATE=(); ROW_FOUND=(); ROW_FIX=()
row() { ROW_NAME+=("$1"); ROW_STATE+=("$2"); ROW_FOUND+=("$3"); ROW_FIX+=("${4:-}"); }

node_fix() {
  # nvm, not the distro's node: apt's is often older than MIN_NODE.
  if [ "$PLATFORM_PKG" = "brew" ]; then printf 'brew install node@%s && brew link --overwrite node@%s' "$NODE_VERSION" "$NODE_VERSION"
  else printf 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/%s/install.sh | bash && export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install %s' "$NVM_VERSION" "$NODE_VERSION"; fi
}

python_fix() {
  case "$PLATFORM_PKG" in
    brew)    printf 'brew install python@3.12' ;;
    apt-get) pkg_install_cmd "python3 python3-venv python3-pip" ;;
    dnf)     pkg_install_cmd "python3 python3-pip" ;;
    pacman)  pkg_install_cmd "python python-pip" ;;
  esac
}

ollama_fix() {
  if [ "$PLATFORM_OS" = "macos" ]; then printf 'brew install ollama'
  else printf 'curl -fsSL https://ollama.com/install.sh | sh'; fi
}

doctor_check() {
  ROW_NAME=(); ROW_STATE=(); ROW_FOUND=(); ROW_FIX=()
  local v

  if have python3; then
    v="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || echo 0)"
    if ! version_ge "$v" "$MIN_PYTHON"; then row "python" old "$v (need $MIN_PYTHON+)" "$(python_fix)"
    elif ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1; then row "python" missing "$v, but no venv/ensurepip" "$(python_fix)"
    else row "python" ok "$v"; fi
  else row "python" missing "not found" "$(python_fix)"; fi

  if have node; then
    v="$(node --version 2>/dev/null | tr -d v)"
    local by=""; [ -n "${NVM_DIR:-}" ] && by=" (nvm)"; have volta && by=" (volta)"; have fnm && by=" (fnm)"
    if version_ge "$v" "$MIN_NODE"; then row "node" ok "$v$by"; else row "node" old "$v (need $MIN_NODE+)" "$(node_fix)"; fi
  else row "node" missing "not found" "$(node_fix)"; fi

  if have pnpm; then row "pnpm" ok "$(pnpm --version 2>/dev/null)"
  elif have corepack; then row "pnpm" missing "not enabled" "corepack enable pnpm"
  elif have npm; then row "pnpm" missing "not found" "npm install -g pnpm"
  else row "pnpm" missing "needs node first" ""; fi

  for t in git curl; do
    if have "$t"; then row "$t" ok "$("$t" --version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"
    else row "$t" missing "not found" "$(pkg_install_cmd "$t")"; fi
  done

  local url="${OLLAMA_BASE_URL:-http://localhost:11434}"
  if have ollama; then
    if curl -fsS --max-time 2 "$url/api/tags" >/dev/null 2>&1; then row "ollama" ok "$(ollama --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -1), running"
    else row "ollama" warn "installed, not running — 'ollama serve'"; fi
  else row "ollama" warn "not found — optional, needed to answer" "$(ollama_fix)"; fi

  if [ "${WITH_SEARCH:-0}" = "1" ]; then
    if have docker && docker info >/dev/null 2>&1; then row "docker" ok "$(docker --version | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"
    else row "docker" missing "needed for --with-search" ""; fi
  fi

  # Not tools, but things that stop a run just as surely.
  local free_gb
  free_gb="$(df -Pk . 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}')"
  if [ "${free_gb:-0}" -ge 5 ]; then row "disk" ok "${free_gb} GB free"; else row "disk" warn "${free_gb:-?} GB free (models need ~2–5 GB)"; fi
  local ram=""
  if [ -r /proc/meminfo ]; then ram="$(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo)"
  elif have sysctl; then ram="$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GB", $1/1073741824}')"; fi
  row "ram" info "${ram:-unknown}"
  if have nvidia-smi; then row "gpu" info "$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)"
  elif [ "$PLATFORM_OS" = "macos" ] && [ "$PLATFORM_ARCH" = "arm64" ]; then row "gpu" info "Apple silicon (unified memory)"
  else row "gpu" info "none detected — CPU inference"; fi
  for p in "${BACKEND_PORT:-8000}" "${FRONTEND_PORT:-5173}"; do
    if curl -s --max-time 1 -o /dev/null "http://localhost:$p" 2>/dev/null; then row "port $p" warn "in use — set it in .env if that isn't Daedalus"
    else row "port $p" ok "free"; fi
  done
}

doctor_print() {
  local i mark colour
  printf '  %s%s%s\n\n' "$DIM" "$(platform_line)" "$RESET"
  for i in "${!ROW_NAME[@]}"; do
    case "${ROW_STATE[$i]}" in
      ok) mark="✓"; colour="$GREEN" ;; info) mark="·"; colour="$DIM" ;;
      warn) mark="!"; colour="$YELLOW" ;; *) mark="✗"; colour="$RED" ;;
    esac
    printf '  %s%s%s %-10s %s\n' "$colour" "$mark" "$RESET" "${ROW_NAME[$i]}" "${ROW_FOUND[$i]}"
  done
}

# Names of the required rows that are not ok.
doctor_blocking() {
  local i
  for i in "${!ROW_NAME[@]}"; do
    case "${ROW_STATE[$i]}" in missing|old) printf '%s ' "${ROW_NAME[$i]}" ;; esac
  done
}

# ── installing ───────────────────────────────────────────────────────────────
confirm() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  [ -t 0 ] || return 1                       # never install unattended without --yes
  local reply; read -r -p "    $1 [y/N] " reply
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# Each tool is offered once per run, however many times the check reruns.
OFFERED=" "
offerable() {
  local i
  for i in "${!ROW_NAME[@]}"; do
    case "${ROW_STATE[$i]}" in missing|old|warn) ;; *) continue ;; esac
    [ -n "${ROW_FIX[$i]}" ] && [[ "$OFFERED" != *" ${ROW_NAME[$i]} "* ]] && return 0
  done
  return 1
}

# Offers each installable row; returns 0 if anything was installed.
doctor_install() {
  local i fix name changed=0
  for i in "${!ROW_NAME[@]}"; do
    name="${ROW_NAME[$i]}"; fix="${ROW_FIX[$i]}"
    case "${ROW_STATE[$i]}" in missing|old|warn) ;; *) continue ;; esac
    [ -n "$fix" ] || continue
    [[ "$OFFERED" == *" $name "* ]] && continue
    OFFERED+="$name "
    # Ollama is optional: offered, but a "no" is fine.
    printf '\n  %s%s%s: %s\n' "$BOLD" "$name" "$RESET" "${ROW_FOUND[$i]}"
    printf '    %s$ %s%s\n' "$DIM" "$fix" "$RESET"
    case "$fix" in *sudo*|*ollama.com/install.sh*) printf '    %s(asks for your password: it installs system-wide)%s\n' "$YELLOW" "$RESET" ;; esac
    if confirm "Install $name?"; then
      if bash -c "$fix"; then
        ok "$name installed"; changed=1
        # nvm installs into this user's home; pick it up in this shell too.
        if [ "$name" = "node" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
          # nvm reads unset variables, which `set -u` would turn into an exit.
          set +u; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use "$NODE_VERSION" >/dev/null 2>&1 || true; set -u
        fi
        hash -r
      else
        err "$name: the install failed — run the command above yourself to see why"
      fi
    else
      info "skipped"
    fi
  done
  return $(( changed == 1 ? 0 : 1 ))
}
