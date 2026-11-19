const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ops', 'metrics-collect.json'), 'utf8'));

// twice a day, not once
cfg.schedule.runsPerDay === 2 || assert.fail('runsPerDay must be 2');
24 % cfg.schedule.intervalHours === 0 || assert.fail('interval must divide a day');
Math.round(24 / cfg.schedule.intervalHours) === cfg.schedule.runsPerDay || assert.fail('interval and runsPerDay disagree');

// cost stays far inside headroom
assert.ok(cfg.costPerDay.workers_requests <= cfg.headroom.workers_requests, 'cost must fit headroom');

// every output has a code consumer
assert.ok(Array.isArray(cfg.consumers) && cfg.consumers.length >= 1, 'must declare consumers');

// prediction is machine-verifiable, not prose
cfg.prediction.signal && cfg.prediction.windowHours > 0 || assert.fail('prediction needs signal and window');

console.log('ok: metrics collect cadence is twice daily, cost bounded, consumers registered');
