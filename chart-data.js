(function (root) {
  function shiftCalendarDate(day, offset) {
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function rangeWindow(day, period) {
    const days = { '1d': 1, '7d': 7, '30d': 30 }[period];
    const startDay = days ? shiftCalendarDate(day, -(days - 1)) : null;
    return {
      start: new Date(`${startDay}T00:00:00+09:00`),
      end: new Date(`${day}T23:59:59.999+09:00`),
    };
  }

  function validPoints(points, window) {
    return (Array.isArray(points) ? points : []).filter(point => {
      const time = Date.parse(point.t);
      return Number.isFinite(time) && typeof point.v === 'number'
        && Number.isFinite(point.v) && point.v > 0
        && time >= window.start.getTime() && time <= window.end.getTime();
    }).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  }

  function alignedComparison(series, codes, window) {
    const timeline = new Map();
    const groups = codes.map(code => {
      const points = validPoints(series[code], window);
      const occurrences = new Map();
      const values = new Map();
      for (const point of points) {
        const time = Date.parse(point.t);
        const ordinal = occurrences.get(time) || 0;
        occurrences.set(time, ordinal + 1);
        const order = Number.isInteger(point.sequence) ? point.sequence : ordinal;
        const key = `${time}|${Number.isInteger(point.sequence) ? 's' : 'o'}${order}`;
        timeline.set(key, { time, order, t: point.t });
        values.set(key, point.v / points[0].v * 100);
      }
      return { code, values };
    }).filter(group => group.values.size);
    const entries = [...timeline.entries()].sort((a, b) => a[1].time - b[1].time || a[1].order - b[1].order);
    return {
      labels: entries.map(([, entry]) => entry.t),
      groups: groups.map(group => ({ code: group.code, values: entries.map(([key]) => group.values.get(key) ?? null) })),
    };
  }

  function snapshotPointIndex(points, snapshot) {
    return points.findIndex(point => Date.parse(point.t) === Date.parse(snapshot.published_at_kst)
      && (!Number.isInteger(point.sequence) || point.sequence === snapshot.sequence));
  }

  const helpers = { shiftCalendarDate, rangeWindow, validPoints, alignedComparison, snapshotPointIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else Object.assign(root, helpers);
})(globalThis);
