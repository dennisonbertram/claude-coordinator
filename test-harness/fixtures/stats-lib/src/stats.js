'use strict';

function mean(values) {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}

module.exports = { mean, median };
