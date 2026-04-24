let latest;
let fetchStatus;
let recentSnapshots = [];
let seriesByPeriod = {};
let chart;
let detailsOpen = false;
let currentPeriod = '1d';
let currentEndDate = null;
let filteredCodes = [];
let activePointIndex = null;
const FIXED_FAVORITE_CODES = ['USD', 'JPY', 'CNY'];

const fmt = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const toKst = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
}).format(new Date(iso));
const formatKstDateTime = (iso) => {
  if (!iso) return '-';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};
const toKstShort = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
}).format(new Date(iso));
const normalizeDateTimeText = (text) => {
  if (!text) return '-';
  const m = String(text).match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분\s*(\d{2})초/);
  if (!m) return text;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
};
const toDateInputValue = (iso) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const shiftDateInputValue = (dateValue, days) => {
  const base = new Date(`${dateValue}T12:00:00+09:00`);
  base.setDate(base.getDate() + days);
  return toDateInputValue(base.toISOString());
};
const getTodayKstValue = () => toDateInputValue(new Date().toISOString());
function getRangeWindow(period) {
  const endDate = currentEndDate || toDateInputValue(latest?.captured_at_utc || new Date().toISOString());
  const start = new Date(`${endDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T23:59:59+09:00`);
  if (period === '1d') return { start, end };
  const days = period === '7d' ? 7 : 30;
  const windowStart = new Date(start);
  windowStart.setDate(windowStart.getDate() - (days - 1));
  return { start: windowStart, end };
}
function filterPoints(points, period) {
  const { start, end } = getRangeWindow(period);
  return points.filter((point) => {
    const dt = new Date(point.t);
    return dt >= start && dt <= end;
  });
}

function formatDetectedTime() {
  if (latest?.viewed_text) return normalizeDateTimeText(latest.viewed_text);
  if (latest?.captured_at_utc) return formatKstDateTime(latest.captured_at_utc);
  return '-';
}

function getHistoryMonthCandidates() {
  const base = latest?.captured_at_utc ? new Date(latest.captured_at_utc) : new Date();
  const current = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit'
  }).format(base).slice(0, 7);
  const prevDate = new Date(base);
  prevDate.setUTCDate(1);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const previous = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit'
  }).format(prevDate).slice(0, 7);
  return [...new Set([current, previous])];
}

async function loadRecentSnapshots() {
  for (const month of getHistoryMonthCandidates()) {
    try {
      const r = await fetch(`./data/history/${month}.ndjson`, { cache: 'no-store' });
      if (!r.ok) continue;
      const text = await r.text();
      const rows = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
      if (rows.length) return rows;
    } catch {
      // ignore and try next candidate
    }
  }
  return [];
}

function getDiffClass(value) {
  if (value > 0) return 'value-up';
  if (value < 0) return 'value-down';
  return 'value-neutral';
}

function setTextAndClass(el, text, className) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('value-up', 'value-down', 'value-neutral', 'pct-up', 'pct-down', 'pct-neutral');
  if (className) el.classList.add(className);
}

function renderFavoriteCodes(selectedCode) {
  const quick = document.getElementById('favorite-codes');
  if (!quick) return;
  const visibleCodes = FIXED_FAVORITE_CODES.filter((code) => latest?.rows?.[code]);
  quick.innerHTML = visibleCodes.map((code) => `
    <button data-favorite-code="${code}" class="${code === selectedCode ? 'active' : ''}" type="button">${code}</button>
  `).join('');
  quick.querySelectorAll('[data-favorite-code]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.favoriteCode;
      const currency = document.getElementById('currency');
      currency.value = code;
      render(code);
    });
  });
}

function applyCurrencyFilter(allCodes, keyword) {
  const currency = document.getElementById('currency');
  const term = keyword.trim().toLowerCase();
  filteredCodes = allCodes.filter((code) => {
    const row = latest.rows[code];
    const haystack = `${code} ${row.country}`.toLowerCase();
    return !term || haystack.includes(term);
  });
  currency.innerHTML = filteredCodes.map((code) => `<option value="${code}">${code} - ${latest.rows[code].country}</option>`).join('');
  return filteredCodes;
}

function moveCurrentDate(days, maxDate) {
  currentEndDate = shiftDateInputValue(currentEndDate, days);
  if (currentEndDate > maxDate) currentEndDate = maxDate;
}

function renderRecentUpdates(code, points = []) {
  const body = document.getElementById('recent-updates-body');
  const caption = document.getElementById('recent-updates-caption');
  if (!body || !caption) return;

  if (!recentSnapshots.length || !latest?.rows?.[code]) {
    caption.textContent = '표시할 이력이 없습니다';
    body.innerHTML = '<tr><td colspan="4">최근 변동 이력이 없습니다.</td></tr>';
    return;
  }

  const items = recentSnapshots
    .filter((snap) => snap?.rows?.[code])
    .slice(-8)
    .reverse();

  caption.textContent = `${code} 기준 최근 ${items.length}건`;

  const baseline = items.length ? Number(items[items.length - 1].rows[code].base_rate) : null;

  body.innerHTML = items.map((snap, index) => {
    const currentRate = Number(snap.rows[code].base_rate);
    const diff = baseline == null ? null : currentRate - baseline;
    const diffText = diff == null ? '-' : `${diff > 0 ? '+' : ''}${fmt(diff)}`;
    const diffClass = diff == null ? 'diff-neutral' : diff > 0 ? 'diff-up' : diff < 0 ? 'diff-down' : 'diff-neutral';
    const published = snap.published_text
      ? normalizeDateTimeText(snap.published_text)
      : (snap.published_at_kst ? toKst(snap.published_at_kst) : '-');
    return `
      <tr class="${index === 0 ? 'is-latest' : ''}">
        <td>${published}</td>
        <td>${snap.sequence || '-'}</td>
        <td>${fmt(currentRate)}</td>
        <td class="${diffClass}">${diffText}</td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('tr[data-published]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => {
      const publishedAt = rowEl.dataset.published;
      if (!publishedAt || !points.length) return;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      points.forEach((point, idx) => {
        const distance = Math.abs(new Date(point.t).getTime() - new Date(publishedAt).getTime());
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = idx;
        }
      });
      activePointIndex = nearestIndex;
      body.querySelectorAll('tr').forEach((tr) => tr.classList.remove('is-selected'));
      rowEl.classList.add('is-selected');
      chart?.update();
    });
  });
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

function updateSummary(points) {
  const current = document.getElementById('summary-current');
  const minmax = document.getElementById('summary-minmax');
  const range = document.getElementById('summary-range');
  const change = document.getElementById('summary-change');
  const changePct = document.getElementById('summary-change-pct');
  if (!current || !minmax || !range || !change || !changePct) return;

  if (!points.length) {
    current.textContent = '-';
    minmax.textContent = '-';
    range.textContent = '-';
    change.textContent = '-';
    changePct.textContent = '-';
    return;
  }

  let highValue = Number.NEGATIVE_INFINITY;
  let lowValue = Number.POSITIVE_INFINITY;
  const firstValue = Number(points[0].v);
  let currentValue = firstValue;
  for (const point of points) {
    const value = Number(point.v);
    if (value > highValue) highValue = value;
    if (value < lowValue) lowValue = value;
    currentValue = value;
  }
  const rangeValue = highValue - lowValue;
  const changeValue = currentValue - firstValue;
  const changePercent = firstValue ? (changeValue / firstValue) * 100 : 0;
  current.textContent = fmt(currentValue);
  minmax.textContent = `${fmt(lowValue)} ~ ${fmt(highValue)}`;
  range.textContent = fmt(rangeValue);
  setTextAndClass(change, `${changeValue > 0 ? '+' : ''}${fmt(changeValue)}`, getDiffClass(changeValue));
  setTextAndClass(changePct, `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`, getDiffClass(changePercent).replace('value', 'pct'));
}

function renderFetchStatus() {
  const statusLine = document.getElementById('meta-status');
  const banner = document.getElementById('status-banner');
  if (!statusLine || !banner) return;

  if (!fetchStatus) {
    statusLine.textContent = '수집 상태: 상태 파일 없음';
    document.getElementById('meta-last-success').textContent = '마지막 성공 수집: 확인 불가';
    banner.hidden = true;
    return;
  }

  const attempted = fetchStatus.last_attempt_at_utc ? formatKstDateTime(fetchStatus.last_attempt_at_utc) : '-';
  const success = !!fetchStatus.last_attempt_success;
  const streak = Number(fetchStatus.failure_streak || 0);
  const total = Number(fetchStatus.total_failures || 0);

  if (success) {
    statusLine.textContent = `수집 상태: 정상 (${attempted})`;
    const lastSuccessLine = fetchStatus.last_attempt_at_utc
      ? `마지막 성공 수집: ${attempted}`
      : '마지막 성공 수집: 확인 불가';
    document.getElementById('meta-last-success').textContent = lastSuccessLine;
    banner.hidden = true;
    banner.classList.remove('ok');
    return;
  }

  const error = fetchStatus.last_error || '원인 정보 없음';
  document.getElementById('meta-last-success').textContent = '마지막 성공 수집: 확인 필요';
  statusLine.textContent = `수집 상태: 실패 (${attempted}, 연속 ${streak}회)`;
  banner.hidden = false;
  banner.classList.remove('ok');
  banner.textContent = `자동 수집 실패, 마지막 시도 ${attempted}, 연속 실패 ${streak}회, 누적 실패 ${total}회, 오류: ${error}`;
}

async function load() {
  const [l, s, status] = await Promise.all([
    fetch('./data/latest.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('./data/series-30d.json', { cache: 'no-store' }).then(r => r.json()),
    loadStatus(),
  ]);
  latest = l;
  fetchStatus = status;
  recentSnapshots = await loadRecentSnapshots();
  seriesByPeriod['1d'] = s.series || {};
  seriesByPeriod['7d'] = s.series || {};
  seriesByPeriod['30d'] = s.series || {};
  const latestDate = toDateInputValue(latest.captured_at_utc);
  currentEndDate = getTodayKstValue();
  if (currentEndDate > latestDate) currentEndDate = latestDate;

  const currency = document.getElementById('currency');
  const codes = Object.keys(latest.rows).sort();
  applyCurrencyFilter(codes, '');
  currency.value = codes.includes('USD') ? 'USD' : codes[0];
  currency.addEventListener('change', () => render(currency.value));

  const currencySearch = document.getElementById('currency-search');
  currencySearch.addEventListener('input', () => {
    const matches = applyCurrencyFilter(codes, currencySearch.value);
    const fallback = matches.includes(currency.value) ? currency.value : (matches[0] || '');
    if (fallback) {
      currency.value = fallback;
      render(fallback);
    }
  });

  renderFavoriteCodes(currency.value);

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

  const rangeEndInput = document.getElementById('range-end-date');
  rangeEndInput.value = currentEndDate;
  rangeEndInput.max = latestDate;
  rangeEndInput.addEventListener('change', () => {
    currentEndDate = rangeEndInput.value || getTodayKstValue();
    if (currentEndDate > latestDate) currentEndDate = latestDate;
    rangeEndInput.value = currentEndDate;
    activePointIndex = null;
    render(currency.value);
  });
  document.getElementById('date-prev').addEventListener('click', () => {
    moveCurrentDate(-1, latestDate);
    rangeEndInput.value = currentEndDate;
    activePointIndex = null;
    render(currency.value);
  });
  document.getElementById('date-next').addEventListener('click', () => {
    moveCurrentDate(1, latestDate);
    rangeEndInput.value = currentEndDate;
    activePointIndex = null;
    render(currency.value);
  });

  document.querySelectorAll('#range-presets [data-range-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.rangePreset;
      if (preset === 'today') currentEndDate = getTodayKstValue();
      if (preset === 'yesterday') currentEndDate = shiftDateInputValue(getTodayKstValue(), -1);
      if (currentEndDate > latestDate) currentEndDate = latestDate;
      rangeEndInput.value = currentEndDate;
      activePointIndex = null;
      render(currency.value);
    });
  });

  document.querySelectorAll('.hint-button').forEach((btn) => {
    btn.title = btn.dataset.hint || '';
    btn.setAttribute('aria-label', btn.dataset.hint || '설명');
  });

  document.getElementById('meta-published').textContent = `고시: ${normalizeDateTimeText(latest.published_text) || '-'} (${latest.sequence || '-'}회차)`;
  document.getElementById('meta-collected').textContent = `수집(KST, UTC+9): ${formatKstDateTime(latest.captured_at_utc)}`;
  document.getElementById('meta-detected').textContent = `최종 감지: ${formatDetectedTime()}`;
  document.getElementById('meta-last-success').textContent = '마지막 성공 수집: 로딩 중...';
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

  renderFavoriteCodes(code);

  document.getElementById('base').textContent = fmt(row.base_rate);
  document.getElementById('send').textContent = fmt(row.send);
  document.getElementById('receive').textContent = fmt(row.receive);

  const series = seriesByPeriod[currentPeriod] || {};
  const points = filterPoints(series[code] || [], currentPeriod);
  renderRecentUpdates(code, points);
  updateSummary(points);
  const labels = [];
  const values = [];
  for (const point of points) {
    labels.push(toKstShort(point.t));
    values.push(point.v);
  }

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
        pointRadius: (ctx) => ctx.dataIndex === activePointIndex ? 4 : 0,
        pointHoverRadius: 5,
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
      plugins: {
        legend: { labels: { color: '#e8eefc' } },
        tooltip: {
          backgroundColor: '#0f1728',
          titleColor: '#e8eefc',
          bodyColor: '#e8eefc',
          padding: 12,
          displayColors: false,
          callbacks: {
            title: (items) => items?.[0]?.label ? `시각 ${items[0].label}` : '',
            label: (item) => `매매기준율 ${fmt(item.parsed.y)}`,
          }
        }
      }
    }
  });
}

async function ensureSeries(period) {
  if (seriesByPeriod[period]) return;
  const data = await fetch('./data/series-30d.json', { cache: 'no-store' }).then(r => r.json());
  seriesByPeriod[period] = data.series || {};
}

load().catch(err => {
  document.getElementById('meta-published').textContent = '고시: 데이터 로드 실패';
  document.getElementById('meta-collected').textContent = '오류: ' + err.message;
  document.getElementById('meta-detected').textContent = '최종 감지: 확인 불가';
  document.getElementById('meta-status').textContent = '수집 상태: 확인 불가';
  const lastSuccess = document.getElementById('meta-last-success');
  if (lastSuccess) lastSuccess.textContent = '마지막 성공 수집: 확인 불가';
});
