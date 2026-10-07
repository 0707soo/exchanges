(function (root) {
  function publicationDay(snapshot) {
    if (!snapshot?.published_at_kst) return null;
    const date = new Date(snapshot.published_at_kst);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  function getDailyFirstDifference(snapshot, code, firstByDate) {
    const day = publicationDay(snapshot);
    const first = day ? firstByDate?.[day] : null;
    if (!first || first.sequence !== 1 || publicationDay(first) !== day) return null;
    const current = snapshot?.rows?.[code]?.base_rate;
    const baseline = first.rates?.[code];
    if (typeof current !== 'number' || typeof baseline !== 'number'
        || !Number.isFinite(current) || !Number.isFinite(baseline)
        || current <= 0 || baseline <= 0) return null;
    return current - baseline;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { publicationDay, getDailyFirstDifference };
  } else {
    root.getDailyFirstDifference = getDailyFirstDifference;
  }
})(globalThis);
