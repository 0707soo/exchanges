const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFetchHealth } = require('../status-health.js');
const now = Date.parse('2026-10-07T14:00:00Z');
test('old successful attempts are delayed', () => {
  assert.equal(getFetchHealth({ last_attempt_success: true, last_attempt_at_utc: '2026-09-18T10:35:00Z' }, now).label, '수집 지연');
});
test('recent failures remain failures and recent successes are healthy', () => {
  const status = { last_attempt_at_utc: '2026-10-07T13:59:00Z' };
  assert.equal(getFetchHealth({ ...status, last_attempt_success: false }, now).label, '실패');
  assert.equal(getFetchHealth({ ...status, last_attempt_success: true }, now).label, '정상');
});
test('missing or invalid timestamps cannot be healthy', () => {
  assert.equal(getFetchHealth(null, now).label, '확인 불가');
  assert.equal(getFetchHealth({ last_attempt_success: true, last_attempt_at_utc: 'bad' }, now).stale, true);
  assert.equal(getFetchHealth({ last_attempt_success: true, last_attempt_at_utc: '2026-10-08T14:00:00Z' }, now).stale, true);
});
test('malformed success flags are unknown and cadence cannot mask a stale run', () => {
  assert.equal(getFetchHealth({ last_attempt_at_utc: '2026-10-07T13:59:00Z', last_attempt_success: 'false' }, now).label, '확인 불가');
  assert.equal(getFetchHealth({ last_attempt_at_utc: '2026-10-07T13:00:00Z', last_attempt_success: true, next_delay_seconds: 999999 }, now).stale, true);
});
