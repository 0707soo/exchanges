(function (root) {
  function getFetchHealth(status, now = Date.now()) {
    if (!status) return { stale: false, label: '확인 불가' };
    const attempted = Date.parse(status.last_attempt_at_utc || '');
    const delay = Number(status.next_delay_seconds);
    const expected = Number.isFinite(delay) && delay > 0 ? delay : 300;
    const stale = !Number.isFinite(attempted) || attempted > now + 300000 ||
      now - attempted > Math.max(1800, expected * 3) * 1000;
    return { stale, label: stale ? '수집 지연' : (status.last_attempt_success ? '정상' : '실패') };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { getFetchHealth };
  else root.getFetchHealth = getFetchHealth;
})(globalThis);
