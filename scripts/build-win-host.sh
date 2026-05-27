#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ps1_path="${script_dir}/build-win-host.ps1"
win_ps1_path="$(wslpath -w "$ps1_path")"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$win_ps1_path" "$@" -RequireElevation