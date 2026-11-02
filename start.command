#!/bin/bash
# 2026 디광 캠핑 게임 앱 — Finder 에서 더블클릭하면 로컬 서버를 켜고 브라우저를 연다 (docs/08-tech.md 1장)
cd "$(dirname "$0")" || exit 1

# Finder 로 실행하면 PATH 가 짧을 수 있어 흔한 설치 위치를 덧붙인다
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

pause_and_exit() {
  echo ""
  read -r -p "Enter 를 누르면 창을 닫습니다 " _
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 이상이 필요합니다 — https://nodejs.org 에서 설치하세요"
  pause_and_exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 이상이 필요합니다 (지금 $(node -v)) — https://nodejs.org 에서 설치하세요"
  pause_and_exit 1
fi

node server.mjs --open "$@"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  pause_and_exit "$STATUS"
fi
