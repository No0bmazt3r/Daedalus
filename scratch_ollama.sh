check_ollama() {
  local url="${OLLAMA_BASE_URL:-http://localhost:11434}"
  [ "$url" = "http://host.docker.internal:11434" ] && url="http://127.0.0.1:11434"
  if curl -fsS --max-time 2 "${url}/api/tags" >/dev/null 2>&1; then
    ok "Ollama reachable at ${url}"
    return 0
  fi

  warn "no Ollama reachable at ${url}"
  
  if have ollama; then
    info "Ollama is installed but not running. Attempting to start it automatically..."
    local started=0
    if [ "$(uname -s)" = "Linux" ]; then
      if have systemctl && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
        sudo systemctl start ollama >/dev/null 2>&1 && started=1
      elif have brew && brew services list 2>/dev/null | grep -q '^ollama'; then
        brew services start ollama >/dev/null 2>&1 && started=1
      fi
    elif [ "$(uname -s)" = "Darwin" ]; then
      if have brew && brew services list 2>/dev/null | grep -q '^ollama'; then
        brew services start ollama >/dev/null 2>&1 && started=1
      else
        open -a Ollama >/dev/null 2>&1 && started=1
      fi
    fi
    
    if [ "$started" -eq 1 ]; then
      sleep 2
      if curl -fsS --max-time 2 "${url}/api/tags" >/dev/null 2>&1; then
        ok "Ollama started successfully!"
        return 0
      fi
    fi
    info "Could not start it automatically. Start it with 'ollama serve' in another terminal,"
    info "or use '--with-ollama' to run it via Docker."
  else
    info "Ollama is not installed on your machine."
    if [ -t 0 ]; then
      printf "    Would you like to install it natively now? [y/N]: "
      read -r ans
      case "$ans" in
        [Yy]* )
          local os; os="$(uname -s)"
          if [ "$os" = "Linux" ]; then
            if [ -f /etc/os-release ] && grep -Eq '(OSTREE_VERSION|VARIANT_ID="?silverblue"?)' /etc/os-release 2>/dev/null; then
              say "    Detected immutable OS (Silverblue/Bluefin). Installing via Homebrew..."
              if brew install ollama; then
                brew services start ollama >/dev/null 2>&1
                ok "Install complete and service started!"
              else
                err "Homebrew installation failed."
              fi
            else
              say "    Running Linux installer (may prompt for sudo)..."
              if curl -fsSL https://ollama.com/install.sh | sh; then
                ok "Install complete!"
              fi
            fi
          elif [ "$os" = "Darwin" ]; then
            say "    Opening the macOS download page..."
            open "https://ollama.com/download/mac" || true
          else
            say "    Please visit https://ollama.com/download to install for your OS."
          fi
          ;;
        * )
          info "Skipping. (The dashboard works without it — only model inference needs it.)"
          ;;
      esac
    else
      info "Install it from https://ollama.com/download to enable model inference."
    fi
  fi
}
