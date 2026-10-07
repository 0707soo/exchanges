#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import time
from collections import deque
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
    value = float(s)
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"Invalid rate: {s}")
    return value


def _parse_currency_label(label: str) -> tuple[str, str, str | None]:
    m = re.match(r"^(.*?)\s+([A-Z]{3})(?:\s*\(([^)]+)\))?$", label.strip())
    if m:
        country = m.group(1).strip()
        code = m.group(2).strip()
        unit = (m.group(3) or "").strip() or None
        return country, code, unit
    return label.strip(), "UNK", None


def fetch_html(target_date: datetime, *, first: bool = False) -> str:
    ymd = target_date.strftime("%Y%m%d")
    payload = {
        "tmpInqStrDt": target_date.strftime("%Y-%m-%d"),
        "pbldDvCd": "1" if first else "3",
        "pbldSqn": "1" if first else "",
        "curCd": "",
        "inqStrDt": ymd,
        "inqKindCd": "1",
    }

    last_error: Exception | None = None
    attempts = 1 if first else 3
    timeout = (5, 10) if first else (5, 20)
    for i in range(attempts):
        try:
            with requests.Session() as s:
                s.headers.update({"User-Agent": "Mozilla/5.0"})
                page = s.get(SOURCE_PAGE, timeout=timeout)
                page.raise_for_status()
                header_options = ({"Referer": SOURCE_PAGE},) if first else ({}, {"Referer": SOURCE_PAGE})
                for headers in header_options:
                    response = s.post(DATA_ENDPOINT, data=payload, headers=headers, timeout=timeout)
                    response.raise_for_status()
                    if "tblBasic" in response.text:
                        return response.text
                last_error = RuntimeError("환율 테이블 미검출")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code not in {408, 429, 500, 502, 503, 504}:
                raise
            last_error = e
        except requests.RequestException as e:
            last_error = e
        if i < attempts - 1:
            time.sleep(2 ** (i + 1))

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


def reverse_lines(path: Path):
    """Read newest NDJSON lines without loading or scanning the whole file."""
    with path.open("rb") as f:
        position = f.seek(0, os.SEEK_END)
        remainder = b""
        while position:
            size = min(position, 65536)
            position -= size
            f.seek(position)
            chunks = (f.read(size) + remainder).split(b"\n")
            remainder = chunks[0]
            for line in reversed(chunks[1:]):
                if line.strip():
                    yield line.decode("utf-8")
        if remainder.strip():
            yield remainder.decode("utf-8")


def load_last_snapshot(path: Path) -> dict | None:
    if not path.exists():
        return None
    line = next(reverse_lines(path), None)
    return json.loads(line) if line else None


def atomic_json(path: Path, value: object):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
            temporary = Path(f.name)
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def validate_snapshot(snapshot: dict, previous: dict | None = None):
    """Reject malformed or regressing upstream responses before writing data."""
    published = snapshot.get("published_at_kst")
    if not published or not snapshot.get("basis_date_text") or snapshot.get("sequence") is None:
        raise ValueError("고시 날짜 또는 회차 누락")
    published_dt = datetime.fromisoformat(published)
    captured_dt = datetime.fromisoformat(snapshot["captured_at_utc"])
    if published_dt.tzinfo is None or captured_dt.tzinfo is None:
        raise ValueError("환율 시각에 시간대 누락")
    if (published_dt - captured_dt).total_seconds() > 300:
        raise ValueError("미래 고시 시각")
    if previous and previous.get("published_at_kst"):
        if published_dt < datetime.fromisoformat(previous["published_at_kst"]):
            raise ValueError("이전 고시보다 오래된 응답")
    rates = snapshot["rates"]
    if not {"USD", "JPY", "EUR", "CNY"}.issubset(rates) or "UNK" in rates:
        raise ValueError("필수 통화 누락 또는 알 수 없는 통화")
    for code, value in rates.items():
        if not re.fullmatch(r"[A-Z]{3}", code) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"유효하지 않은 매매기준율: {code}")


def append_snapshot(snapshot: dict):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    month_file = HISTORY_DIR / f"{datetime.now(KST).strftime('%Y-%m')}.ndjson"
    prev = load_last_snapshot(month_file)

    if prev and prev.get("published_text") == snapshot.get("published_text") and prev.get("sequence") == snapshot.get("sequence"):
        return False

    with month_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(snapshot, ensure_ascii=False, allow_nan=False) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return True


def publication_day(snapshot: dict) -> str | None:
    try:
        dt = datetime.fromisoformat(snapshot["published_at_kst"])
        return dt.astimezone(KST).date().isoformat() if dt.tzinfo else None
    except (KeyError, TypeError, ValueError):
        return None


def valid_daily_first(snapshot: dict, day: str) -> bool:
    try:
        validate_snapshot(snapshot)
        return snapshot.get("sequence") == 1 and publication_day(snapshot) == day
    except (KeyError, TypeError, ValueError):
        return False


def update_daily_first(snapshots):
    """Cache verified bank first publications separately from the display window."""
    path = DATA_DIR / "daily-first.json"
    baselines = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    baselines = {day: snap for day, snap in baselines.items() if valid_daily_first(snap, day)}
    for snap in snapshots:
        day = publication_day(snap)
        if day and valid_daily_first(snap, day):
            baselines[day] = snap
    # Resolve the dates actually displayed, newest first; bound network work.
    days = list(dict.fromkeys(publication_day(snap) for snap in reversed(list(snapshots)[-8:])))
    for day in [day for day in days if day and day not in baselines][:2]:
        try:
            html = fetch_html(datetime.fromisoformat(day).replace(tzinfo=KST), first=True)
            rows = extract_rows(html)
            if len({row.code for row in rows}) != len(rows):
                raise ValueError("최초 고시 중복 통화")
            first = {
                **extract_meta(html),
                "captured_at_utc": datetime.now(timezone.utc).isoformat(),
                "rates": {row.code: row.base_rate for row in rows},
            }
            if not valid_daily_first(first, day):
                raise ValueError("최초 고시 날짜 또는 1회차 불일치")
            baselines[day] = first
        except (requests.RequestException, RuntimeError, ValueError) as error:
            print(f"최초 고시 미확인 {day}: {error}")
    atomic_json(path, baselines)
    return baselines


def rebuild_series(*, refresh_baselines=False):
    series: dict[str, list[dict]] = {}
    snapshots = deque(maxlen=3000)
    for file in sorted(HISTORY_DIR.glob("*.ndjson"), reverse=True):
        for line in reverse_lines(file):
            snapshots.appendleft(json.loads(line))
            if len(snapshots) == snapshots.maxlen:
                break
        if len(snapshots) == snapshots.maxlen:
            break
    for snap in snapshots:
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

    atomic_json(DATA_DIR / "series.json", {"series": series})
    baseline_path = DATA_DIR / "daily-first.json"
    baselines = update_daily_first(snapshots) if refresh_baselines else (
        json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else {}
    )
    # The browser displays only a few recent rows, not the raw monthly archive.
    atomic_json(DATA_DIR / "recent.json", {"first_by_date": baselines, "snapshots": [
        {
            "published_text": snap.get("published_text"),
            "published_at_kst": snap.get("published_at_kst"),
            "captured_at_utc": snap.get("captured_at_utc"),
            "sequence": snap.get("sequence"),
            "rows": {code: {"base_rate": value} for code, value in snap["rates"].items()},
        }
        for snap in list(snapshots)[-100:]
    ]})

    # 기간별 경량 파일
    for label, count in (("1d", 144), ("7d", 1008), ("30d", 3000)):
        atomic_json(DATA_DIR / f"series-{label}.json", {"series": {k: v[-count:] for k, v in series.items()}})


def main():
    now_utc = datetime.now(timezone.utc)
    now_kst = now_utc.astimezone(KST)

    html = fetch_html(now_kst)
    meta = extract_meta(html)
    rows = extract_rows(html)
    if len({row.code for row in rows}) != len(rows):
        raise ValueError("중복 통화 코드")

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

    latest_path = DATA_DIR / "latest.json"
    previous = json.loads(latest_path.read_text(encoding="utf-8")) if latest_path.exists() else None
    validate_snapshot(snapshot, previous)

    changed = append_snapshot(snapshot)
    rebuild_series(refresh_baselines=True)
    atomic_json(latest_path, snapshot)

    print(f"rows={len(rows)} changed={changed} sequence={meta.get('sequence')}")


if __name__ == "__main__":
    main()
