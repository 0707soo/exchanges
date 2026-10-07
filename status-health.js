(function (root) {
  function getFetchHealth(status, now = Date.now()) {
    if (!status) return { stale: false, label: '확인 불가' };
    const attempted = Date.parse(status.last_attempt_at_utc || '');
    const stale = !Number.isFinite(attempted) || attempted > now + 300000 ||
      now - attempted > 1800000;
    const result = status.last_attempt_success;
    return { stale, label: stale ? '수집 지연' : (result === true ? '정상' : result === false ? '실패' : '확인 불가') };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { getFetchHealth };
  else root.getFetchHealth = getFetchHealth;
})(globalThis);
