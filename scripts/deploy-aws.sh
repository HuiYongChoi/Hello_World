#!/usr/bin/env bash
#
# realty 사이트를 AWS(Bitnami) 서버로 배포합니다.
#
# 접속 정보는 이 파일에 넣지 않습니다. 저장소가 공개라 서버 주소·키 경로가
# 그대로 노출되기 때문입니다. 값은 .env.deploy (gitignore 처리됨) 에 두거나
# 환경변수로 넘기세요.
#
#   cp .env.deploy.example .env.deploy   # 값 채우기
#   ./scripts/deploy-aws.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

# .env.deploy 가 있으면 읽어들입니다.
if [[ -f .env.deploy ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.deploy && set +a
fi

: "${DEPLOY_HOST:?DEPLOY_HOST 가 필요합니다 (예: bitnami@1.2.3.4)}"
: "${DEPLOY_KEY:?DEPLOY_KEY 가 필요합니다 (SSH 개인키 경로)}"
DEPLOY_WEB_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
DEPLOY_SITE_PATH="${DEPLOY_SITE_PATH:-hyrealty}"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "✗ SSH 키를 찾을 수 없습니다: $DEPLOY_KEY" >&2
  exit 1
fi

# 개인키 권한이 느슨하면 ssh 가 거부합니다.
key_perm=$(stat -f '%Lp' "$DEPLOY_KEY" 2>/dev/null || stat -c '%a' "$DEPLOY_KEY")
if [[ "$key_perm" != "400" && "$key_perm" != "600" ]]; then
  echo "→ SSH 키 권한을 400 으로 조정합니다 (현재 $key_perm)"
  chmod 400 "$DEPLOY_KEY"
fi

echo "→ 빌드"
npm --prefix simulator run deploy:realty

TARGET="$DEPLOY_WEB_ROOT/$DEPLOY_SITE_PATH"
STAGE="/tmp/realty-$$.html"

echo "→ 업로드: $DEPLOY_HOST:$TARGET/index.html"
# bitnami 사용자는 웹 루트에 직접 쓸 수 없어 /tmp 경유 후 sudo 로 옮깁니다.
scp -i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new \
  realty/index.html "$DEPLOY_HOST:$STAGE"

ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST" \
  "sudo mkdir -p '$TARGET' \
   && sudo mv '$STAGE' '$TARGET/index.html' \
   && sudo chmod 644 '$TARGET/index.html'"

echo "✓ 배포 완료 → /$DEPLOY_SITE_PATH/"
