#!/usr/bin/env python3
"""
전세 신호 감시 — 후보판에 남은 집에서 "곧 나올 법한 전세" 를 매일 메일로.

    python3 jeonse_watch.py              # 매일 한 번 (systemd 타이머)
    python3 jeonse_watch.py --dry-run    # 메일 대신 화면에 출력
    python3 jeonse_watch.py --summary    # 앞으로 6개월 만기 요약을 지금 보냄

메일과 함께 SIGNALS_OUT(기본: 같은 폴더 signals.json)에 **사이트 후보판이 읽는
신호 파일**을 씁니다. 서버에서는 /var/www/html/hyrealty/signals.json 으로 둡니다.

매물 사이트는 공식 API 가 없고 크롤링이 약관상 금지라 **지금 올라온 매물**은
못 잡습니다. 대신 국토부 전월세 실거래에 적힌 **계약기간 · 신규/갱신** 으로
언제 세입자가 나갈 가능성이 큰지를 미리 잡습니다.

    ① 만기 도래     계약 끝나는 달이 3개월 안으로 들어온 전세 — 보통 2~3개월 전에 매물로 나옴
    ② 갱신 끝난 계약 이미 한 번 갱신했다면 또 갱신할 권리가 없어 만기에 나올 가능성이 높음
    ③ 새 계약       후보 단지에 새로 신고된 계약 — 방금 한 채가 나갔고 그 가격

파이썬 표준 라이브러리만 씁니다(서버에 따로 설치할 것이 없도록).
설정은 같은 폴더의 .env (저장소에 올리지 않음) 와 watchlist.json 입니다.
"""
import datetime as dt
import html
import json
import os
import re
import shutil
import smtplib
import sys
import time
import urllib.request
from email.mime.text import MIMEText
from email.utils import formataddr

HERE = os.path.dirname(os.path.abspath(__file__))
ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
KST = dt.timezone(dt.timedelta(hours=9))
WINDOW_MONTHS = 3          # 만기 몇 개월 전부터 알릴까
HISTORY_MONTHS = 25        # 2년 계약의 시작까지 거슬러 올라감
STABLE_AFTER_MONTHS = 3    # 이보다 오래된 달은 신고가 끝났다고 보고 캐시


def load_env():
    env = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    env.update({k: v for k, v in os.environ.items() if k in ("MOLIT_API_KEY", "SMTP_USER", "SMTP_PASS", "MAIL_TO", "SIGNALS_OUT")})
    return env


def tag(xml, name):
    m = re.search(rf"<{name}>(.*?)</{name}>", xml, re.S)
    return m.group(1).strip() if m else ""


def months_back(today, n):
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def fetch_month(key, lawd, ym):
    """한 달치 — Encoding 키는 한 번 더 인코딩하면 안 되므로 URL 에 그대로 붙입니다."""
    deals, page = [], 1
    while True:
        url = f"{ENDPOINT}?serviceKey={key}&LAWD_CD={lawd}&DEAL_YMD={ym}&numOfRows=1000&pageNo={page}"
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    xml = r.read().decode("utf-8")
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        code = tag(xml, "resultCode")
        if code not in ("000", "00"):
            raise RuntimeError(f"API 오류 {lawd} {ym}: {code} {tag(xml, 'resultMsg') or xml[:200]}")
        items = re.findall(r"<item>.*?</item>", xml, re.S)
        for it in items:
            deals.append({
                "seq": tag(it, "aptSeq"),
                "name": tag(it, "aptNm"),
                "area": float(tag(it, "excluUseAr") or 0),
                "floor": tag(it, "floor"),
                "term": tag(it, "contractTerm"),
                "type": tag(it, "contractType"),
                "rr": tag(it, "useRRRight"),
                "dep": int((tag(it, "deposit") or "0").replace(",", "")),
                "rent": int((tag(it, "monthlyRent") or "0").replace(",", "") or 0),
                "date": f"{tag(it, 'dealYear')}-{int(tag(it, 'dealMonth') or 0):02d}-{int(tag(it, 'dealDay') or 0):02d}",
                "preDep": tag(it, "preDeposit"),
            })
        total = int(tag(xml, "totalCount") or 0)
        if page * 1000 >= total or not items:
            return deals
        page += 1


def load_deals(key, lawds, today):
    cache_dir = os.path.join(HERE, "cache")
    os.makedirs(cache_dir, exist_ok=True)
    stable = set(months_back(today, HISTORY_MONTHS)[STABLE_AFTER_MONTHS:])
    out = []
    for lawd in lawds:
        for ym in months_back(today, HISTORY_MONTHS):
            path = os.path.join(cache_dir, f"{lawd}-{ym}.json")
            if ym in stable and os.path.exists(path):
                out += json.load(open(path, encoding="utf-8"))
                continue
            deals = fetch_month(key, lawd, ym)
            json.dump(deals, open(path, "w", encoding="utf-8"), ensure_ascii=False)
            out += deals
            time.sleep(0.2)
    return out


def contract_end(term):
    """'26.10~28.10' → (2028, 10)"""
    m = re.search(r"~\s*(\d{2})\.(\d{1,2})", term or "")
    return (2000 + int(m.group(1)), int(m.group(2))) if m else None


def month_diff(a, b):
    return (a[0] - b[0]) * 12 + (a[1] - b[1])


def matches(d, w):
    return d["seq"] == w["cx"] and abs(round(d["area"]) - w["area"]) <= 1


def deal_key(d):
    return "|".join(str(d[k]) for k in ("seq", "area", "floor", "date", "dep", "rent", "term"))


def won(v_manwon):
    return f"{v_manwon / 10000:.2f}억" if v_manwon >= 10000 else f"{v_manwon:,}만"


def site_signals(deals, watch, today):
    """후보판이 읽는 신호 — 줄 id 마다 6개월 안 만기와 최근 45일 새 계약"""
    now = (today.year, today.month)
    since = (today - dt.timedelta(days=45)).isoformat()
    rows = {}
    for w in watch:
        mine = [d for d in deals if matches(d, w)]
        up, recent = [], []
        for d in mine:
            if d["rent"] == 0:
                end = contract_end(d["term"])
                if end and 0 <= month_diff(end, now) <= 6:
                    up.append({"end": f"{end[0]}-{end[1]:02d}", "gap": month_diff(end, now), "floor": d["floor"],
                               "dep": d["dep"] * 10000, "type": d["type"], "locked": d["type"] == "갱신" or d["rr"] == "사용"})
            if d["date"] >= since:
                recent.append({"date": d["date"], "floor": d["floor"], "dep": d["dep"] * 10000,
                               "rent": d["rent"] * 10000, "type": d["type"], "term": d["term"]})
        if up or recent:
            rows[w["id"]] = {"upcoming": sorted(up, key=lambda x: x["end"]), "recent": sorted(recent, key=lambda x: x["date"], reverse=True)}
    return {"kind": "masan-jeonse-signals", "asOf": today.isoformat(),
            "generatedAt": dt.datetime.now(KST).isoformat(timespec="minutes"),
            "windowMonths": WINDOW_MONTHS, "rows": rows}


def build_signals(deals, watch, state, today):
    now = (today.year, today.month)
    seen = set(state.get("seen", []))
    alerted = set(state.get("alerted", []))
    first_run = not state.get("seen")
    new_deals, expiring, upcoming = [], [], []
    for w in watch:
        mine = [d for d in deals if matches(d, w)]
        alert = w.get("alert", True)          # 후보판에서 소거한 집은 메일을 안 보냄
        for d in mine:
            k = deal_key(d)
            if k not in seen and not first_run and alert:
                new_deals.append((w, d))
            seen.add(k)
            if d["rent"] != 0:
                continue
            end = contract_end(d["term"])
            if not end:
                continue
            gap = month_diff(end, now)
            if 0 <= gap <= 6 and alert:
                upcoming.append((w, d, end, gap))
            if 0 <= gap <= WINDOW_MONTHS and alert:
                ek = "exp|" + deal_key(d)
                if ek not in alerted:
                    expiring.append((w, d, end, gap))
                    alerted.add(ek)
    state["seen"] = sorted(seen)
    state["alerted"] = sorted(alerted)
    return new_deals, expiring, upcoming, first_run


TH = 'style="text-align:left;padding:6px 10px;border-bottom:1px solid #ccd;background:#eef2f1;font-size:12px"'
TD = 'style="padding:6px 10px;border-bottom:1px solid #e3e7e6;font-size:13px"'


def table(head, rows):
    h = "".join(f"<th {TH}>{html.escape(x)}</th>" for x in head)
    b = "".join("<tr>" + "".join(f"<td {TD}>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table style="border-collapse:collapse;margin:6px 0 18px">{"<tr>" + h + "</tr>"}{b}</table>'


def exp_rows(items):
    rows = []
    for w, d, end, gap in sorted(items, key=lambda x: (x[2], x[0]["name"])):
        locked = d["type"] == "갱신" or d["rr"] == "사용"
        rows.append([
            html.escape(w["name"]), f'{w["area"]}㎡', f'{d["floor"]}층',
            f"<b>{end[0]}.{end[1]:02d}</b> ({'이번 달' if gap == 0 else f'{gap}개월 뒤'})",
            won(d["dep"]), html.escape(d["type"] or "—"),
            "<b style='color:#b3392f'>갱신 끝남 — 나올 가능성 높음</b>" if locked else "신규 계약 — 세입자가 갱신할 수 있음",
        ])
    return rows


def compose(new_deals, expiring, upcoming, first_run, summary, watch, today):
    parts, subject_bits = [], []
    if first_run or summary:
        parts.append(f"<p>감시 중인 후보 <b>{len(watch)}곳</b> — 앞으로 6개월 안에 끝나는 전세 계약입니다. 보통 만기 2~3개월 전에 매물로 나옵니다.</p>")
        parts.append(table(["단지", "평형", "층", "만기", "보증금", "계약", "읽는 법"], exp_rows(upcoming)) if upcoming else "<p>6개월 안에 끝나는 전세 계약이 없습니다.</p>")
        subject_bits.append(f"6개월 만기 요약 {len(upcoming)}건")
    if expiring and not first_run:
        parts.append(f"<h3 style='margin:14px 0 4px'>① 만기 {WINDOW_MONTHS}개월 안으로 들어온 전세 {len(expiring)}건</h3>")
        parts.append(table(["단지", "평형", "층", "만기", "보증금", "계약", "읽는 법"], exp_rows(expiring)))
        subject_bits.insert(0, f"만기 도래 {len(expiring)}건")
    if new_deals:
        rows = [[html.escape(w["name"]), f'{w["area"]}㎡', f'{d["floor"]}층', d["date"],
                 "전세 " + won(d["dep"]) if d["rent"] == 0 else f'월세 {won(d["dep"])} / {d["rent"]}만',
                 html.escape(d["type"] or "—"), html.escape(d["term"] or "—")]
                for w, d in sorted(new_deals, key=lambda x: x[1]["date"], reverse=True)]
        parts.append(f"<h3 style='margin:14px 0 4px'>③ 후보 단지에 새로 신고된 계약 {len(new_deals)}건</h3>")
        parts.append("<p style='color:#5d6b66;font-size:12px'>방금 한 채가 나갔다는 뜻입니다 — 이 가격이 지금 시세입니다.</p>")
        parts.append(table(["단지", "평형", "층", "계약일", "조건", "계약", "기간"], rows))
        subject_bits.append(f"새 계약 {len(new_deals)}건")
    if not parts:
        return None, None
    foot = (
        "<p style='color:#8a9692;font-size:11px;margin-top:18px'>국토부 아파트 전월세 실거래(계약 후 30일 안에 신고) 기준입니다. "
        "매물이 아니라 체결된 계약이고, 동·호수는 없어 층까지만 압니다. 같은 층·같은 만기가 두 줄이면 두 세대인지 중복 신고인지 가릴 수 없습니다. "
        "후보는 hyrealty 후보판에서 소거하지 않은 집입니다.</p>"
    )
    body = f"<div style='font-family:-apple-system,Apple SD Gothic Neo,sans-serif;color:#17201d'>{''.join(parts)}{foot}</div>"
    subject = f"[마산 전세 신호] {' · '.join(subject_bits)} ({today:%m/%d})"
    return subject, body


def send(env, subject, body):
    msg = MIMEText(body, "html", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr(("마산 전세 신호", env["SMTP_USER"]))
    msg["To"] = env["MAIL_TO"]
    with smtplib.SMTP_SSL(env.get("SMTP_HOST", "smtp.gmail.com"), int(env.get("SMTP_PORT", "465")), timeout=30) as s:
        s.login(env["SMTP_USER"], env["SMTP_PASS"])
        s.sendmail(env["SMTP_USER"], [a.strip() for a in env["MAIL_TO"].split(",")], msg.as_string())


def main():
    dry = "--dry-run" in sys.argv
    summary = "--summary" in sys.argv
    env = load_env()
    if not env.get("MOLIT_API_KEY"):
        sys.exit(".env 에 MOLIT_API_KEY 가 없습니다")
    watch = json.load(open(os.path.join(HERE, "watchlist.json"), encoding="utf-8"))["jeonse"]
    state_path = os.path.join(HERE, "state.json")
    state = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}
    today = dt.datetime.now(KST).date()
    lawds = sorted({w["cx"].split("-")[0] for w in watch})
    deals = load_deals(env["MOLIT_API_KEY"], lawds, today)
    new_deals, expiring, upcoming, first_run = build_signals(deals, watch, state, today)
    # 매달 1일에는 6개월 요약도 같이 보냅니다.
    subject, body = compose(new_deals, expiring, upcoming, first_run, summary or today.day == 1, watch, today)

    # 사이트용 신호 파일은 메일 설정과 상관없이 먼저 씁니다.
    sig = site_signals(deals, watch, today)
    out = env.get("SIGNALS_OUT") or os.path.join(HERE, "signals.json")
    tmp = os.path.join(HERE, "signals.tmp.json")
    json.dump(sig, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    shutil.copyfile(tmp, out)                 # 웹 폴더는 파일 쓰기 권한만 있어도 되게
    print(f"신호 파일: {out} ({len(sig['rows'])}줄)")

    save_state = not dry
    if subject:
        if dry:
            print(subject)
            print(re.sub(r"<[^>]+>", " ", body.replace("</tr>", "\n")).replace("  ", " ")[:6000])
        elif not all(env.get(k) for k in ("SMTP_USER", "SMTP_PASS", "MAIL_TO")):
            # 메일 설정 전에는 알린 것으로 치지 않습니다 — 설정하면 그때 한 번에 갑니다.
            print("메일 설정(SMTP_USER · SMTP_PASS · MAIL_TO)이 없어 메일은 건너뜀:", subject)
            save_state = False
        else:
            send(env, subject, body)
            print("보냄:", subject)
    else:
        print("새 신호 없음")
    if save_state:
        json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"거래 {len(deals)}건 · 후보 {len(watch)}곳 · 새 계약 {len(new_deals)} · 만기 도래 {len(expiring)} · 6개월 안 {len(upcoming)}")


if __name__ == "__main__":
    main()
