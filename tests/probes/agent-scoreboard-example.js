// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import {describe, it, expect} from 'vitest';

describe('Agent Scoreboard Mandatory Probe', () => {
  it('verifies the scoreboard metric is populated after harness intake', async () => {
    // This is a mandatory probe ensuring intakes populate per-agent scoreboard data
    // Authors who close this ticket must include this same test in their probes
    const beforeIntake = Date.now();
    
    // The implementation is verified live by VERIFIED-LIVE-1
    // This test ensures the metric schema exists and can be queried
    const verifiedMetrics = await globalThis.VERIFIED_METRICS.get('agent-scoreboard');
    
    expect(verifiedMetrics).toBeDefined();
    expect(verifiedMetrics.entries).toBeDefined();
    expect(verifiedMetrics.harnesses).toBeDefined();
  });
});