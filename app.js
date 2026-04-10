let latest;
let series;
let chart;

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

async function load() {
  const [l, s] = await Promise.all([
    fetch('./data/latest.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('./data/series.json', { cache: 'no-store' }).then(r => r.json()),
  ]);
  latest = l;
  series = s.series || {};

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

  document.getElementById('meta-published').textContent = `고시: ${latest.published_text || '-'} (${latest.sequence || '-'}회차)`;
  document.getElementById('meta-collected').textContent = `수집(KST, UTC+9): ${toKst(latest.captured_at_utc)}`;
  render(currency.value);
}

function render(code) {
  const row = latest.rows[code];
  if (!row) return;

  document.getElementById('base').textContent = fmt(row.base_rate);
  document.getElementById('send').textContent = fmt(row.send);
  document.getElementById('receive').textContent = fmt(row.receive);

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

load().catch(err => {
  document.getElementById('meta-published').textContent = '고시: 데이터 로드 실패';
  document.getElementById('meta-collected').textContent = '오류: ' + err.message;
});
