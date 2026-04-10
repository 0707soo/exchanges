let latest;
let series;
let chart;

const fmt = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

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

  document.getElementById('meta').textContent = `고시: ${latest.published_text || '-'} (${latest.sequence || '-'}회차) · 수집(UTC): ${latest.captured_at_utc}`;
  render(currency.value);
}

function render(code) {
  const row = latest.rows[code];
  if (!row) return;

  document.getElementById('base').textContent = fmt(row.base_rate);
  document.getElementById('send').textContent = fmt(row.send);
  document.getElementById('receive').textContent = fmt(row.receive);

  const points = series[code] || [];
  const labels = points.map(p => p.t.replace('T', ' ').slice(0, 16));
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
  document.getElementById('meta').textContent = '데이터 로드 실패: ' + err.message;
});
