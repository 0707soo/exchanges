const test = require('node:test');
const assert = require('node:assert/strict');
const { getDailyFirstDifference, publicationDay } = require('../rate-baseline.js');

const row = (day, rate) => ({ published_at_kst: `${day}T19:32:00+09:00`, rows: { USD: { base_rate: rate } } });
const first = (day, rate) => ({ published_at_kst: `${day}T08:24:40+09:00`, sequence: 1, rates: { USD: rate } });

test('mixed dates use each bank first publication, independently of visible rows', () => {
  const baselines = { '2026-10-07': first('2026-10-07', 1343.4), '2026-09-18': first('2026-09-18', 1380) };
  assert.ok(Math.abs(getDailyFirstDifference(row('2026-10-07', 1340), 'USD', baselines) + 3.4) < 1e-9);
  assert.equal(getDailyFirstDifference(row('2026-09-18', 1385.5), 'USD', baselines), 5.5);
  assert.equal(getDailyFirstDifference(row('2026-10-07', 1343.4), 'USD', baselines), 0);
});

test('missing, wrong-date, wrong-sequence and invalid rates have no comparison', () => {
  const current = row('2026-10-07', 1340);
  for (const baseline of [undefined, first('2026-09-18', 1385.4), { ...first('2026-10-07', 1343.4), sequence: 609 }, first('2026-10-07', NaN), first('2026-10-07', 0)]) {
    assert.equal(getDailyFirstDifference(current, 'USD', { '2026-10-07': baseline }), null);
  }
  assert.equal(getDailyFirstDifference(current, 'JPY', {}), null);
});

test('publication date uses Korea time and never falls back to capture date', () => {
  assert.equal(publicationDay({ published_at_kst: '2026-10-06T23:30:00Z' }), '2026-10-07');
  assert.equal(publicationDay({ captured_at_utc: '2026-10-07T12:00:00Z' }), null);
});
