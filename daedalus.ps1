# Daedalus on Windows: a doorway to daedalus.sh, which holds all the logic.
#
# Windows has no bash and macOS/Linux have no PowerShell, so the one script
# that does everything (daedalus.sh) runs inside WSL, and this file only gets
# you there: it checks for WSL, offers to install it, then passes every
# command straight through.
#
#   .\daedalus.ps1 setup        same as ./daedalus.sh setup
#   .\daedalus.ps1 dev          same as ./daedalus.sh dev, and so on
#
# Blocked by the execution policy? powershell -ExecutionPolicy Bypass -File .\daedalus.ps1 setup
# (ASCII only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.)

$ErrorActionPreference = 'Stop'

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
$distros = @()
if ($wsl) {
  # `wsl -l -q` prints UTF-16 with NULs; strip them before reading names.
  $distros = (& wsl.exe -l -q 2>$null) -replace "`0", '' | Where-Object { $_.Trim() }
}

if (-not $wsl -or $distros.Count -eq 0) {
  Write-Host '  [x] Daedalus runs in WSL (Windows Subsystem for Linux), and it is not set up.' -ForegroundColor Red
  Write-Host '      Install it with Ubuntu (asks for administrator rights, then needs a restart):'
  Write-Host '        wsl --install -d Ubuntu' -ForegroundColor Cyan
  $reply = Read-Host '      Run it now? [y/N]'
  if ($reply -match '^(y|yes)$') {
    Start-Process wsl.exe -ArgumentList '--install', '-d', 'Ubuntu' -Verb RunAs -Wait
    Write-Host '      Restart Windows, open Ubuntu once to create your user, then run this again.' -ForegroundColor Yellow
  }
  exit 1
}

# A checkout on a Windows drive works through WSL but every file access crosses
# into Windows, so installs and the dev servers are several times slower.
if ($PSScriptRoot -match '^[A-Za-z]:\\') {
  Write-Host '  note: running from a Windows drive via WSL. It works; cloning inside WSL (~/Daedalus) is much faster.' -ForegroundColor DarkGray
}

& wsl.exe --cd "$PSScriptRoot" -- ./daedalus.sh @args
exit $LASTEXITCODE
