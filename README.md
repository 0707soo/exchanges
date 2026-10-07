# exchanges

하나은행 현재환율 페이지를 기준으로 환율을 자동 수집하고, GitHub Pages에서 시각화합니다.

## 자동화
- 수집 스크립트: `scripts/fetch_rates.py`
- 수집 워크플로: `.github/workflows/rates-burst-sync.yml`
- 수집 워크플로는 GitHub Actions 예약 실행으로 5분마다 동작하며, 기본 브랜치의 코드 변경과 `workflow_dispatch` 수동 실행으로도 시작됩니다. 데이터 커밋은 재실행을 유발하지 않습니다.
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

## 수집 안정성
- 응답의 고시 날짜·회차·필수 통화·숫자를 검증합니다. 오래된 응답과 비정상 수치는 최신 데이터를 덮어쓰지 않습니다.
- 네트워크 요청은 최대 3회 재시도하며, 전체 수집 시도에는 300초 제한이 있습니다.
- JSON 파일은 임시 파일에 저장한 뒤 교체합니다. 수집 실패 시 마지막 성공 시각을 보존하고 상태와 로그를 기록합니다.
- 차트는 이력의 최근 3,000개 스냅샷에서 생성합니다. 월별 원본 이력은 저장소에 계속 보존합니다.
- 화면의 최근 이력은 경량 파일인 `data/recent.json`을 사용합니다. Pages에는 정적 화면과 JSON만 배포합니다.
- 최근 변동의 ‘최초 대비’는 각 고시 날짜의 하나은행 1회차 매매기준율과 비교합니다. `data/daily-first.json`에 검증된 최초 고시를 별도로 보존하므로 표시 건수와 관계없습니다. 같은 날짜의 1회차를 확인하지 못하면 `-`로 표시합니다.
- 마지막 시도가 30분 이상 지연되면 화면에 수집 지연을 표시합니다. 야간·휴일의 고시 시각과 실제 수집 시각은 별도로 표시합니다.
- ChatGPT의 2시간 간격 점검 작업은 GitHub의 수집 예약과 별도로 설정된 감시 작업입니다.

## 테스트
```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/*.test.cjs
```
