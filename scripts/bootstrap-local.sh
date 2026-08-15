#!/usr/bin/env bash
#
# 맥 로컬 개발 환경을 한 번에 준비합니다.
#
#   저장소 밖에서 실행 → 바탕화면에 클론
#   저장소 안에서 실행 → master 로 전환 후 최신화
#
# 그 다음 의존성을 설치하고, 준비된 명령을 안내합니다.
# 비밀정보는 다루지 않습니다 — 서버 접속 정보는 .env.deploy 에 별도로 둡니다.
#
set -euo pipefail

REPO_URL="https://github.com/HuiYongChoi/Hello_World.git"
DEST="${DEST:-$HOME/Desktop/부동산시뮬레이터}"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. 필수 도구 ────────────────────────────────────────────────
say "필수 도구 확인"

command -v git >/dev/null || die "git 이 없습니다. 터미널에서 'xcode-select --install' 을 먼저 실행하세요."
ok "git $(git --version | awk '{print $3}')"

if ! command -v node >/dev/null; then
  warn "Node.js 가 없습니다."
  if command -v brew >/dev/null; then
    say "Homebrew 로 Node 를 설치합니다"
    brew install node
  else
    die "https://nodejs.org 에서 LTS 를 설치한 뒤, 터미널을 새로 열고 다시 실행하세요."
  fi
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if (( NODE_MAJOR < 20 )); then
  die "Node $(node -v) 는 너무 낮습니다. Vite 는 20.19+ 또는 22.12+ 가 필요합니다."
fi
ok "node $(node -v)"

# ── 2. 저장소 확보 ──────────────────────────────────────────────
say "저장소 준비"

if git rev-parse --git-dir >/dev/null 2>&1; then
  # 이미 저장소 안에서 실행된 경우
  REPO_ROOT=$(git rev-parse --show-toplevel)
  cd "$REPO_ROOT"
  ok "기존 저장소 사용: $REPO_ROOT"
else
  if [[ -d "$DEST/.git" ]]; then
    cd "$DEST"
    ok "기존 클론 사용: $DEST"
  else
    mkdir -p "$(dirname "$DEST")"
    git clone "$REPO_URL" "$DEST"
    cd "$DEST"
    ok "클론 완료: $DEST"
  fi
fi

# 작업 중인 변경이 있으면 건드리지 않습니다.
if [[ -n "$(git status --porcelain)" ]]; then
  warn "커밋되지 않은 변경이 있어 브랜치 전환을 건너뜁니다."
  git status --short
else
  git checkout master --quiet
  git pull --ff-only origin master --quiet
  ok "master 최신화 ($(git rev-parse --short HEAD))"
fi

# ── 3. 의존성 ───────────────────────────────────────────────────
say "의존성 설치"
npm --prefix simulator install --silent
ok "설치 완료"

# ── 4. 검증 ─────────────────────────────────────────────────────
say "엔진 테스트"
npm --prefix simulator test --silent

# ── 5. 안내 ─────────────────────────────────────────────────────
say "준비 완료 — $(pwd)"
cat <<'GUIDE'

  개발 서버        cd simulator && npm run dev
  테스트           cd simulator && npm test
  Pages 재배포     cd simulator && npm run deploy:realty   (이후 커밋·푸시)
  서버 배포        ./scripts/deploy-aws.sh                 (.env.deploy 필요)

  이어서 작업하려면 이 폴더에서 Claude Code 를 실행하세요.
  루트의 CLAUDE.md 를 자동으로 읽어 지금까지의 맥락을 이어받습니다.

      claude

GUIDE

if ! command -v claude >/dev/null; then
  warn "Claude Code CLI 가 없습니다:  npm install -g @anthropic-ai/claude-code"
fi

if [[ ! -f .env.deploy ]]; then
  warn "서버 배포를 쓰려면:  cp .env.deploy.example .env.deploy  후 값 입력"
fi

open . 2>/dev/null || true
