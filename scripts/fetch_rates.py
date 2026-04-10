#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
HISTORY_DIR = DATA_DIR / "history"

SOURCE_PAGE = "https://hanabank.com/cont/mall/mall15/mall1501/index.jsp"
DATA_ENDPOINT = "https://hanabank.com/cms/rate/wpfxd651_01i_01.do"
KST = ZoneInfo("Asia/Seoul")


@dataclass
class RateRow:
    country: str
    code: str
    unit_label: str | None
    cash_buy: float
    cash_sell: float
    send: float
    receive: float
    base_rate: float
    usd_rate: float


class RateTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.table_depth = 0
        self.in_row = False
        self.in_cell = False
        self.cell_buf: list[str] = []
        self.current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            cls = attrs.get("class", "")
            if ("tblBasic" in cls) and not self.in_table:
                self.in_table = True
                self.table_depth = 1
                return
            if self.in_table:
                self.table_depth += 1
                return

        if not self.in_table:
            return

        if tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in ("th", "td"):
            self.in_cell = True
            self.cell_buf = []

    def handle_data(self, data):
        if self.in_table and self.in_cell:
            self.cell_buf.append(data)

    def handle_endtag(self, tag):
        if not self.in_table:
            return

        if self.in_row and self.in_cell and tag in ("th", "td"):
            text = " ".join("".join(self.cell_buf).split())
            self.current_row.append(text)
            self.in_cell = False
            self.cell_buf = []
        elif self.in_row and tag == "tr":
            if any(cell.strip() for cell in self.current_row):
                self.rows.append(self.current_row)
            self.in_row = False
        elif tag == "table":
            self.table_depth -= 1
            if self.table_depth == 0:
                self.in_table = False


def _to_float(s: str) -> float:
    s = s.replace(",", "").strip()
    if not s:
        return 0.0
    return float(s)


def _parse_currency_label(label: str) -> tuple[str, str, str | None]:
    m = re.match(r"^(.*?)\s+([A-Z]{3})(?:\s*\(([^)]+)\))?$", label.strip())
    if m:
        country = m.group(1).strip()
        code = m.group(2).strip()
        unit = (m.group(3) or "").strip() or None
        return country, code, unit
    return label.strip(), "UNK", None


def fetch_html(target_date: datetime) -> str:
    ymd = target_date.strftime("%Y%m%d")
    payload = {
        "tmpInqStrDt": target_date.strftime("%Y-%m-%d"),
        "pbldDvCd": "3",
        "pbldSqn": "",
        "curCd": "",
        "inqStrDt": ymd,
        "inqKindCd": "1",
    }

    last_error: Exception | None = None
    for i in range(5):
        try:
            s = requests.Session()
            s.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            })
            s.get(SOURCE_PAGE, timeout=30)

            r = s.post(DATA_ENDPOINT, data=payload, timeout=30)
            r.raise_for_status()
            html = r.text
            if "tblBasic" in html:
                return html

            r2 = s.post(DATA_ENDPOINT, data=payload, headers={"Referer": SOURCE_PAGE}, timeout=30)
            r2.raise_for_status()
            html = r2.text
            if "tblBasic" in html:
                return html

            last_error = RuntimeError("환율 테이블 미검출")
        except Exception as e:
            last_error = e

        time.sleep(2 + i)

    raise RuntimeError(f"환율 수집 실패: {last_error}")


def extract_meta(html: str) -> dict:
    basis = re.search(r"기준일</em>\s*:\s*<strong>\s*([^<]+)\s*</strong>", html)
    pub_date = re.search(r"고시일시</em>\s*:\s*<strong>\s*([^<]+)\s*</strong>\s*<strong>\s*([^<]+)\s*</strong>", html)
    seq = re.search(r"\((\d+)회차\)", html)
    view = re.search(r"조회시각</em>\s*:\s*<strong>\s*([^<]+)\s*</strong>", html)
    published_text = (f"{pub_date.group(1).strip()} {pub_date.group(2).strip()}") if pub_date else None
    published_at_kst = None
    if published_text:
        m = re.search(r"(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분\s*(\d{2})초", published_text)
        if m:
            dt = datetime(
                int(m.group(1)), int(m.group(2)), int(m.group(3)),
                int(m.group(4)), int(m.group(5)), int(m.group(6)),
                tzinfo=KST,
            )
            published_at_kst = dt.isoformat()

    return {
        "basis_date_text": basis.group(1).strip() if basis else None,
        "published_text": published_text,
        "published_at_kst": published_at_kst,
        "sequence": int(seq.group(1)) if seq else None,
        "viewed_text": view.group(1).strip() if view else None,
    }


def extract_rows(html: str) -> list[RateRow]:
    p = RateTableParser()
    p.feed(html)

    rows: list[RateRow] = []
    for row in p.rows:
        if len(row) != 11:
            continue
        if row[0] in {"통화", "사실 때", "환율"}:
            continue

        country, code, unit = _parse_currency_label(row[0])
        rows.append(
            RateRow(
                country=country,
                code=code,
                unit_label=unit,
                cash_buy=_to_float(row[1]),
                cash_sell=_to_float(row[3]),
                send=_to_float(row[5]),
                receive=_to_float(row[6]),
                base_rate=_to_float(row[8]),
                usd_rate=_to_float(row[10]),
            )
        )

    if not rows:
        raise RuntimeError("환율 테이블 파싱 실패")
    return rows


def load_last_snapshot(path: Path) -> dict | None:
    if not path.exists():
        return None
    last = None
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                last = json.loads(line)
    return last


def append_snapshot(snapshot: dict):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    month_file = HISTORY_DIR / f"{datetime.now(KST).strftime('%Y-%m')}.ndjson"
    prev = load_last_snapshot(month_file)

    if prev and prev.get("published_text") == snapshot.get("published_text") and prev.get("sequence") == snapshot.get("sequence"):
        return False

    with month_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(snapshot, ensure_ascii=False) + "\n")
    return True


def rebuild_series():
    series: dict[str, list[dict]] = {}
    for file in sorted(HISTORY_DIR.glob("*.ndjson")):
        with file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                snap = json.loads(line)
                ts = snap.get("published_at_kst")
                if not ts and snap.get("published_text"):
                    m = re.search(r"(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분\s*(\d{2})초", snap["published_text"])
                    if m:
                        ts = datetime(
                            int(m.group(1)), int(m.group(2)), int(m.group(3)),
                            int(m.group(4)), int(m.group(5)), int(m.group(6)),
                            tzinfo=KST,
                        ).isoformat()
                if not ts:
                    ts = snap["captured_at_utc"]
                for code, v in snap["rates"].items():
                    series.setdefault(code, []).append({"t": ts, "v": v})

    for code in list(series.keys()):
        series[code] = series[code][-3000:]

    (DATA_DIR / "series.json").write_text(
        json.dumps({"series": series}, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 기간별 경량 파일
    (DATA_DIR / "series-1d.json").write_text(
        json.dumps({"series": {k: v[-144:] for k, v in series.items()}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA_DIR / "series-7d.json").write_text(
        json.dumps({"series": {k: v[-1008:] for k, v in series.items()}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA_DIR / "series-30d.json").write_text(
        json.dumps({"series": {k: v[-3000:] for k, v in series.items()}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main():
    now_utc = datetime.now(timezone.utc)
    now_kst = now_utc.astimezone(KST)

    try:
        html = fetch_html(now_kst)
        meta = extract_meta(html)
        rows = extract_rows(html)
    except Exception as e:
        latest_path = DATA_DIR / "latest.json"
        if latest_path.exists():
            print(f"skip update: {e}")
            return
        raise

    rates = {r.code: r.base_rate for r in rows}
    row_map = {
        r.code: {
            "country": r.country,
            "unit_label": r.unit_label,
            "cash_buy": r.cash_buy,
            "cash_sell": r.cash_sell,
            "send": r.send,
            "receive": r.receive,
            "base_rate": r.base_rate,
            "usd_rate": r.usd_rate,
        }
        for r in rows
    }

    snapshot = {
        "source": SOURCE_PAGE,
        "captured_at_utc": now_utc.isoformat(),
        **meta,
        "rates": rates,
        "rows": row_map,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    changed = append_snapshot(snapshot)
    rebuild_series()

    print(f"rows={len(rows)} changed={changed} sequence={meta.get('sequence')}")


if __name__ == "__main__":
    main()
