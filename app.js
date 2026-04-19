let latest;
let fetchStatus;
let seriesByPeriod = {};
let chart;
let detailsOpen = false;
let currentPeriod = '1d';

const fmt = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const toKst = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
}).format(new Date(iso));
const toKstShort = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
}).format(new Date(iso));

function formatDetectedTime() {
  if (latest?.viewed_text) return latest.viewed_text;
  if (latest?.captured_at_utc) return `${toKst(latest.captured_at_utc)} (KST, UTC+9)`;
  return '-';
}

async function loadStatus() {
  try {
    const r = await fetch('./data/status.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch {
    return null;
  }
}

function renderFetchStatus() {
  const statusLine = document.getElementById('meta-status');
  const banner = document.getElementById('status-banner');
  if (!statusLine || !banner) return;

  if (!fetchStatus) {
    statusLine.textContent = '수집 상태: 상태 파일 없음';
    banner.hidden = true;
    return;
  }

  const attempted = fetchStatus.last_attempt_at_utc ? toKst(fetchStatus.last_attempt_at_utc) : '-';
  const success = !!fetchStatus.last_attempt_success;
  const streak = Number(fetchStatus.failure_streak || 0);
  const total = Number(fetchStatus.total_failures || 0);

  if (success) {
    statusLine.textContent = `수집 상태: 정상 (${attempted})`;
    banner.hidden = true;
    banner.classList.remove('ok');
    return;
  }

  const error = fetchStatus.last_error || '원인 정보 없음';
  statusLine.textContent = `수집 상태: 실패 (${attempted}, 연속 ${streak}회)`;
  banner.hidden = false;
  banner.classList.remove('ok');
  banner.textContent = `자동 수집 실패, 마지막 시도 ${attempted}, 연속 실패 ${streak}회, 누적 실패 ${total}회, 오류: ${error}`;
}

async function load() {
  const [l, s, status] = await Promise.all([
    fetch('./data/latest.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('./data/series-1d.json', { cache: 'no-store' }).then(r => r.json()),
    loadStatus(),
  ]);
  latest = l;
  fetchStatus = status;
  seriesByPeriod['1d'] = s.series || {};

  const currency = document.getElementById('currency');
  const codes = Object.keys(latest.rows).sort();
  currency.innerHTML = codes.map(c => `<option value="${c}">${c} - ${latest.rows[c].country}</option>`).join('');
  currency.value = codes.includes('USD') ? 'USD' : codes[0];
  currency.addEventListener('change', () => render(currency.value));

  document.querySelectorAll('[data-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (codes.includes(btn.dataset.code)) {
        currency.value = btn.dataset.code;
        render(btn.dataset.code);
      }
    });
  });

  document.querySelectorAll('#periods [data-period]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const period = btn.dataset.period;
      if (!period || period === currentPeriod) return;
      await ensureSeries(period);
      currentPeriod = period;
      document.querySelectorAll('#periods [data-period]').forEach(b => b.classList.toggle('active', b.dataset.period === period));
      render(currency.value);
    });
  });

  document.getElementById('meta-published').textContent = `고시: ${latest.published_text || '-'} (${latest.sequence || '-'}회차)`;
  document.getElementById('meta-collected').textContent = `수집(KST, UTC+9): ${toKst(latest.captured_at_utc)}`;
  document.getElementById('meta-detected').textContent = `최종 감지: ${formatDetectedTime()}`;
  renderFetchStatus();

  const baseToggle = document.getElementById('base-toggle');
  baseToggle.addEventListener('click', () => {
    detailsOpen = !detailsOpen;
    syncCardsVisibility();
  });

  window.addEventListener('resize', syncCardsVisibility);
  syncCardsVisibility();
  render(currency.value);
}

function syncCardsVisibility() {
  const cards = document.getElementById('cards');
  const baseToggle = document.getElementById('base-toggle');
  if (!cards || !baseToggle) return;
  cards.classList.toggle('open', detailsOpen);
  baseToggle.setAttribute('aria-expanded', String(detailsOpen));
}

function render(code) {
  const row = latest.rows[code];
  if (!row) return;

  document.getElementById('base').textContent = fmt(row.base_rate);
  document.getElementById('send').textContent = fmt(row.send);
  document.getElementById('receive').textContent = fmt(row.receive);

  const series = seriesByPeriod[currentPeriod] || {};
  const points = series[code] || [];
  const labels = points.map(p => toKstShort(p.t));
  const values = points.map(p => p.v);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${code} 매매기준율`,
        data: values,
        borderColor: '#67b7ff',
        backgroundColor: 'rgba(103,183,255,0.2)',
        tension: 0.2,
        pointRadius: 0,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: '#9fb0d0' }, grid: { color: '#1d2b49' } },
        y: { ticks: { color: '#9fb0d0' }, grid: { color: '#1d2b49' } },
      },
      plugins: { legend: { labels: { color: '#e8eefc' } } }
    }
  });
}

async function ensureSeries(period) {
  if (seriesByPeriod[period]) return;
  const map = {
    '7d': './data/series-7d.json',
    '30d': './data/series-30d.json',
  };
  const path = map[period] || './data/series-1d.json';
  const data = await fetch(path, { cache: 'no-store' }).then(r => r.json());
  seriesByPeriod[period] = data.series || {};
}

load().catch(err => {
  document.getElementById('meta-published').textContent = '고시: 데이터 로드 실패';
  document.getElementById('meta-collected').textContent = '오류: ' + err.message;
  document.getElementById('meta-detected').textContent = '최종 감지: 확인 불가';
  document.getElementById('meta-status').textContent = '수집 상태: 확인 불가';
});
