# exchanges

하나은행 현재환율 페이지를 기준으로 환율을 자동 수집하고, GitHub Pages에서 시각화합니다.

## 자동화
- 수집 스크립트: `scripts/fetch_rates.py`
- 수집 워크플로: `.github/workflows/rates-burst-sync.yml`
- 수집 워크플로는 GitHub Actions 예약 실행으로 5분마다 동작하며, `workflow_dispatch`로 수동 실행할 수도 있습니다.
- 최신 데이터: `data/latest.json`
- 상태 데이터: `data/status.json`
- 누적 데이터: `data/history/YYYY-MM.ndjson`
- 차트 데이터: `data/series.json`
- 데이터 push는 수집 워크플로에서만 수행합니다.
- 수집 완료 후 `deploy-pages` 워크플로가 GitHub Pages를 배포합니다.
- `chain-keeper`와 `pages-keeper`는 별도 수동 감시 워크플로입니다. 수집 예약은 이 keeper 실행 여부에 의존하지 않습니다.

GitHub Actions 예약 실행은 플랫폼 사정에 따라 지연될 수 있습니다. 즉시 수집하려면 Actions에서 `rates-burst-sync`를 수동 실행하세요.

## 수동 실행
```bash
python3 scripts/fetch_rates.py
```

또는 GitHub Actions에서 `rates-burst-sync` 워크플로를 실행할 수 있습니다.

## 주의
- 원본 페이지 구조가 변경되면 파서 업데이트가 필요합니다.
- GitHub Actions 기반 자동화 특성상 정책, 제한, 플랫폼 동작 변화에 따라 구조를 다시 조정해야 할 수 있습니다.
