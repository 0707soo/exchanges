const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function appContext(overrides = {}) {
  const context = vm.createContext({
    window: { location: { search: '' } }, document: {},
    URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    ...overrides,
  });
  // Exercise the real application functions without starting its page-load request.
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8').split('\nload().catch(')[0];
  vm.runInContext(source, context);
  return context;
}

test('a failed HTTP response is rejected instead of becoming chart data', async () => {
  const context = appContext({ fetch: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(vm.runInContext("fetchJson('data/series-30d.json')", context), /HTTP 503/);
});

test('malformed latest data cannot replace the displayed snapshot', () => {
  const context = appContext();
  assert.throws(() => vm.runInContext("validateLatest({rows: {USD: {base_rate: 0}}, published_at_kst: '2026-10-07T21:01:00+09:00', captured_at_utc: '2026-10-07T12:00:00Z'})", context), /Invalid latest rates/);
  assert.throws(() => vm.runInContext("validateLatest({rows: {USD: {base_rate: 100}}})", context), /Invalid latest metadata/);
});

test('search rebuilding options preserves a selected matching currency', () => {
  const select = {
    value: 'JPY',
    set innerHTML(html) {
      this.options = [...html.matchAll(/<option value="([A-Z]{3})"/g)].map(match => match[1]);
      this.value = this.options[0] || '';
    },
  };
  const context = appContext({ document: { getElementById: () => select } });
  vm.runInContext("latest = { rows: {EUR: {country: '유럽'}, JPY: {country: '일본'}, USD: {country: '미국'}} }; applyCurrencyFilter(['EUR', 'JPY', 'USD'], '')", context);
  assert.equal(select.value, 'JPY');
  vm.runInContext("applyCurrencyFilter(['EUR', 'JPY', 'USD'], '일본')", context);
  assert.equal(select.value, 'JPY');
  assert.deepEqual(select.options, ['JPY']);
});

test('an unavailable chart library does not turn valid rate data into a load failure', () => {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, querySelectorAll: () => [], classList: { remove() {}, add() {} } });
    return elements.get(id);
  } };
  const context = appContext({ document, ...require('../chart-data.js') });
  vm.runInContext("latest = {rows: {USD: {base_rate: 1340}}, captured_at_utc: '2026-10-07T12:00:00Z'}; currentEndDate = '2026-10-07'; render('USD')", context);
  assert.equal(elements.get('base').textContent, '1,340');
  assert.equal(elements.get('chart-message').hidden, false);
  assert.match(elements.get('chart-message').textContent, /차트를 불러올 수 없습니다/);
});
