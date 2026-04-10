# exchanges

하나은행 현재환율 페이지를 기준으로 환율을 자동 수집하고, GitHub Pages에서 시각화합니다.

## 자동화
- 수집 주기: 10분 (`3,13,23,33,43,53 * * * *`)
- 수집 스크립트: `scripts/fetch_rates.py`
- 최신 데이터: `data/latest.json`
- 누적 데이터: `data/history/YYYY-MM.ndjson`
- 차트 데이터: `data/series.json`

## 실행
```bash
python3 scripts/fetch_rates.py
```

## 주의
원본 페이지 구조가 변경되면 파서 업데이트가 필요합니다.
