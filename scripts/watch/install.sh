#!/usr/bin/env bash
# 전세 신호 감시를 서버에 깔거나 갱신합니다.
#
#   ./scripts/watch/install.sh                 # 설치·갱신 + 한 번 돌려 신호 파일 만들기
#   ./scripts/watch/install.sh --send-summary  # 설치 후 6개월 만기 요약 메일을 바로 한 통
#
# 필요한 것
#   .env.deploy   서버 접속 (DEPLOY_HOST · DEPLOY_KEY) — 이미 있음
#   .env.local    MOLIT_API_KEY — 이미 있음
#   .env.watch    메일 설정 (SMTP_USER · SMTP_PASS · MAIL_TO) — 없으면 메일 없이 신호 파일만
#
# 비밀번호는 서버의 ~/jeonse-watch/.env (권한 600) 에만 들어가고 저장소에는 안 올라갑니다.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env.deploy; set +a
: "${DEPLOY_HOST:?}"; : "${DEPLOY_KEY:?}"
WEB="${DEPLOY_WEB_ROOT:-/var/www/html}/${DEPLOY_SITE_PATH:-hyrealty}"
USER_NAME="${DEPLOY_HOST%@*}"
SSH=(ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST")

[[ -f scripts/watch/watchlist.json ]] || node scripts/watch/make-watchlist.mjs

MOLIT=$(grep '^MOLIT_API_KEY=' .env.local | cut -d= -f2- | tr -d '"\r')
ENV_TMP=$(mktemp)
trap 'rm -f "$ENV_TMP"' EXIT
{
  echo "MOLIT_API_KEY=$MOLIT"
  echo "SIGNALS_OUT=$WEB/signals.json"
  if [[ -f .env.watch ]]; then grep -E '^(SMTP_USER|SMTP_PASS|SMTP_HOST|SMTP_PORT|MAIL_TO)=' .env.watch; fi
} > "$ENV_TMP"
grep -q '^SMTP_PASS=.\+' "$ENV_TMP" && echo "→ 메일 설정 있음" || echo "→ 메일 설정 없음 (.env.watch) — 신호 파일만 만듭니다"

echo "→ 파일 올리기"
"${SSH[@]}" "mkdir -p ~/jeonse-watch && chmod 700 ~/jeonse-watch"
scp -q -i "$DEPLOY_KEY" scripts/watch/jeonse_watch.py scripts/watch/watchlist.json "$DEPLOY_HOST:~/jeonse-watch/"
scp -q -i "$DEPLOY_KEY" "$ENV_TMP" "$DEPLOY_HOST:~/jeonse-watch/.env"

echo "→ 매일 아침 8시(KST) 예약"
"${SSH[@]}" "set -e
chmod 600 ~/jeonse-watch/.env
sudo touch '$WEB/signals.json' && sudo chown '$USER_NAME' '$WEB/signals.json' && sudo chmod 644 '$WEB/signals.json'
sudo tee /etc/systemd/system/jeonse-watch.service >/dev/null <<UNIT
[Unit]
Description=마산 전세 신호 감시 (메일 + 후보판 signals.json)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
WorkingDirectory=/home/$USER_NAME/jeonse-watch
ExecStart=/usr/bin/python3 /home/$USER_NAME/jeonse-watch/jeonse_watch.py
UNIT
sudo tee /etc/systemd/system/jeonse-watch.timer >/dev/null <<UNIT
[Unit]
Description=매일 08:00 KST 전세 신호

[Timer]
OnCalendar=*-*-* 23:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now jeonse-watch.timer >/dev/null"

echo "→ 지금 한 번 돌리기"
if [[ "${1:-}" == "--send-summary" ]]; then
  "${SSH[@]}" "cd ~/jeonse-watch && python3 jeonse_watch.py --summary"
else
  "${SSH[@]}" "sudo systemctl start jeonse-watch.service; sudo journalctl -u jeonse-watch.service -n 6 --no-pager -o cat"
fi
"${SSH[@]}" "systemctl list-timers jeonse-watch.timer --no-pager | head -3"
echo "✓ 전세 신호 감시 설치 완료"
