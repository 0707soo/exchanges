const test = require('node:test');
const assert = require('node:assert/strict');
const { shiftCalendarDate, rangeWindow, validPoints, alignedComparison, snapshotPointIndex } = require('../chart-data.js');

test('Korean calendar windows include midnight boundaries and shift across months', () => {
  assert.equal(shiftCalendarDate('2026-10-01', -1), '2026-09-30');
  const window = rangeWindow('2026-10-07', '7d');
  assert.equal(window.start.toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-10-07T14:59:59.999Z');
  assert.equal(validPoints([{ t: '2026-10-07T23:59:59.999+09:00', v: 1 }, { t: '2026-10-08T00:00:00+09:00', v: 2 }], window).length, 1);
});

test('invalid points are excluded and out-of-order points are sorted', () => {
  const window = rangeWindow('2026-10-07', '1d');
  const points = validPoints([{ t: '2026-10-07T10:00:00+09:00', v: 2 }, { t: 'bad', v: 3 }, { t: '2026-10-07T09:00:00+09:00', v: 1 }, { t: '2026-10-07T11:00:00+09:00', v: NaN }], window);
  assert.deepEqual(points.map(point => point.v), [1, 2]);
  assert.deepEqual(validPoints(null, window), []);
});

test('comparison keeps missing observations as gaps and aligns repeated times by sequence', () => {
  const t = '2026-10-07T21:01:00+09:00';
  const result = alignedComparison({ USD: [{ t, sequence: 609, v: 100 }, { t, sequence: 611, v: 110 }], EUR: [{ t, sequence: 611, v: 200 }] }, ['USD', 'EUR'], rangeWindow('2026-10-07', '1d'));
  assert.equal(result.labels.length, 2);
  assert.deepEqual(result.groups[1].values, [null, 100]);
  assert.ok(Math.abs(result.groups[0].values[1] - 110) < 1e-9);
});

test('row selection uses the exact publication and sequence, not a nearby date', () => {
  const t = '2026-10-07T21:01:00+09:00';
  const points = [{ t, sequence: 609, v: 100 }, { t, sequence: 611, v: 110 }];
  assert.equal(snapshotPointIndex(points, { published_at_kst: t, sequence: 611 }), 1);
  assert.equal(snapshotPointIndex(points, { published_at_kst: '2026-09-18T19:32:00+09:00', sequence: 785 }), -1);
});
