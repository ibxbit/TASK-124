'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeGrowth, WARN_GROWTH } = require('../backend/src/services/memoryService');

test('High-Load Memory Stress Simulation', async () => {
    const baseline = 100 * 1024 * 1024; // 100 MB
    let current = baseline;

    // Simulate 1000 settlement operations
    for (let i = 0; i < 1000; i++) {
        // Each op adds a small amount of non-garbage-collected memory (simulated)
        current += 10 * 1024; // 10 KB leak per op
    }

    const growth = computeGrowth(baseline, current);
    const growthPercentage = (growth * 100).toFixed(2);

    console.log(`[stress] Final growth after 1000 ops: ${growthPercentage}%`);

    // Assert that even under this load, growth is < 20% (it should be ~10MB / 100MB = 10%)
    assert.ok(growth <= WARN_GROWTH, `Growth of ${growthPercentage}% exceeded warning threshold`);
});
