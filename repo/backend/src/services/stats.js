'use strict';

// Standard-normal CDF (Abramowitz-Stegun) + two-sided z-test for proportions.

function normCdf(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function twoSidedZTest(successA, trialsA, successB, trialsB, alpha = 0.05) {
  if (!trialsA || !trialsB) {
    return { zScore: 0, pValue: 1, significant: false, pooledP: 0 };
  }
  const pA = successA / trialsA;
  const pB = successB / trialsB;
  const pooledP = (successA + successB) / (trialsA + trialsB);
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / trialsA + 1 / trialsB));
  if (se === 0) return { zScore: 0, pValue: 1, significant: false, pooledP };
  const z = (pA - pB) / se;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  return { zScore: z, pValue, significant: pValue < alpha, pooledP };
}

module.exports = { twoSidedZTest, normCdf };
