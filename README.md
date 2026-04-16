# exchanges

하나은행 현재환율 페이지를 기준으로 환율을 자동 수집하고, GitHub Pages에서 시각화합니다.

## 자동화
- 수집 스크립트: `scripts/fetch_rates.py`
- 메인 워크플로: `.github/workflows/rates-burst-sync.yml`
- 최신 데이터: `data/latest.json`
- 상태 데이터: `data/status.json`
- 누적 데이터: `data/history/YYYY-MM.ndjson`
- 차트 데이터: `data/series.json`

현재 자동화는 GitHub `schedule` 대신 세 개의 `workflow_dispatch` 기반 워크플로로 운용합니다.

- `rates-burst-sync`는 수집과 데이터 커밋만 담당합니다.
- `chain-keeper`는 장기 실행으로 수집 상태를 감시하고, 필요할 때 `rates-burst-sync`를 다시 호출합니다.
- `pages-keeper`는 장기 실행으로 Pages 배포를 감시하고, `deploy-pages`를 주기적으로 호출합니다.
- 주간 폴링 간격은 120초입니다.
- 데이터 push는 수집 워크플로에서만 수행합니다.
- KST 22:00~06:00 사이에는 다음 run까지의 대기 시간을 길게 둡니다.
- Pages 배포는 `deploy-pages` 워크플로가 최신 `main` 기준으로 처리합니다.

## 수동 실행
```bash
python3 scripts/fetch_rates.py
```

또는 GitHub Actions에서 `rates-burst-sync` 워크플로를 직접 실행해 체인을 시작할 수 있습니다.

## 주의
- 원본 페이지 구조가 변경되면 파서 업데이트가 필요합니다.
- GitHub Actions 기반 자동화 특성상 정책, 제한, 플랫폼 동작 변화에 따라 구조를 다시 조정해야 할 수 있습니다.
