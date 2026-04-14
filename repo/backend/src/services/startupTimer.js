'use strict';

// Minimal, zero-dependency boot-time instrumentation.
//
//   const t = new StartupTimer().mark('boot');
//   ...
//   t.mark('pg_started');
//   ...
//   t.mark('interactive');
//   t.summary()  → { totalMs, interactiveMs, phases: [{ phase, ms }, ...] }
//
// Persists the summary to `startup_events.notes` (JSON) and emits a single
// structured log line. All timing uses monotonic performance.now() so it's
// immune to wall-clock adjustments during boot.

const { performance } = require('perf_hooks');

const TARGET_INTERACTIVE_MS = 5_000;

class StartupTimer {
  constructor(label = 'startup') {
    this.label = label;
    this.startedAt = new Date();
    this.marks = [];
    this.mark('boot');
  }

  mark(phase) {
    this.marks.push({ phase, t: performance.now() });
    return this;
  }

  // Useful when measuring a single task: timer.time('migrations', async () => { ... })
  async time(phase, fn) {
    const t0 = performance.now();
    const result = await fn();
    this.marks.push({ phase, t: performance.now(), duration: performance.now() - t0 });
    return result;
  }

  summary() {
    if (this.marks.length < 2) {
      return { totalMs: 0, interactiveMs: 0, phases: [] };
    }
    const phases = [];
    for (let i = 1; i < this.marks.length; i++) {
      phases.push({
        phase: this.marks[i].phase,
        ms: Math.round(this.marks[i].t - this.marks[i - 1].t)
      });
    }
    const total = this.marks[this.marks.length - 1].t - this.marks[0].t;

    // "Interactive" = we have completed the 'listening' mark (HTTP server ready).
    const interactiveMark = this.marks.find(m => m.phase === 'listening')
                         || this.marks.find(m => m.phase === 'interactive');
    const interactiveMs = interactiveMark
      ? Math.round(interactiveMark.t - this.marks[0].t)
      : Math.round(total);

    return {
      label: this.label,
      startedAt: this.startedAt,
      totalMs: Math.round(total),
      interactiveMs,
      target: TARGET_INTERACTIVE_MS,
      withinTarget: interactiveMs <= TARGET_INTERACTIVE_MS,
      phases
    };
  }

  // Writes a row to startup_events carrying the per-phase breakdown as notes.
  async persist(db) {
    const s = this.summary();
    const readyAt = new Date(this.startedAt.getTime() + s.interactiveMs);
    try {
      await db.query(
        `INSERT INTO startup_events (started_at, ready_at, duration_ms, pid, notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [this.startedAt, readyAt, s.interactiveMs, process.pid, JSON.stringify(s)]);
    } catch (err) {
      // startup_events may not exist on first-ever boot; never block readiness on this.
      console.error('[startup] persist failed:', err.message);
    }
    return s;
  }
}

module.exports = { StartupTimer, TARGET_INTERACTIVE_MS };
