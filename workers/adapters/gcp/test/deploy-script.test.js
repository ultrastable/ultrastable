// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-R03, R04 and R10: static checks on the Cloud Run deploy script and the orchestrator manifest. The script has never run against a project, so
// what can be proved without one is proved here: the shape of what it does. The live run stays a closing probe (see the status section of US-SPEC-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const script = readFileSync(here('../deploy.sh'), 'utf8');
const cron = JSON.parse(readFileSync(here('../k8s/tick-cronjob.json'), 'utf8'));

test('US-14-R03: the deploy script pins one instance, binds secret access for the service account and keeps the Cloud Scheduler OIDC identity', () => {
  assert.match(script, /--max-instances 1\b/);
  assert.match(script, /secrets add-iam-policy-binding ultrastable-tick-token[^\n]*--member "serviceAccount:\$\{SA\}"[^\n]*roles\/secretmanager\.secretAccessor/);
  assert.ok(script.indexOf('add-iam-policy-binding ultrastable-tick-token') < script.indexOf('gcloud run deploy'), 'the binding exists before the revision that needs it');
  assert.match(script, /--oidc-service-account-email "\$SA" --oidc-token-audience "\$URL"/);
  assert.match(script, /--no-allow-unauthenticated/);
  assert.match(script, /--set-secrets "TICK_TOKEN=ultrastable-tick-token:latest"/);
  assert.match(script, /uptimeCheckConfigs[\s\S]*\\"path\\":\\"\/health\\"[\s\S]*\\"period\\":\\"60s\\"/, 'an uptime check on /health every minute');
  assert.match(script, /serviceAgentAuthentication[\s\S]*OIDC_TOKEN/, 'the check authenticates, because the service refuses unauthenticated calls');
  assert.match(script, /roles\/run\.invoker/, 'and the Monitoring service agent may invoke the service');
  assert.ok(!/uptime[^\n]*\|\| true/.test(script) && !/uptimeCheckConfigs[^\n]*\|\| true/.test(script), 'a failed uptime check is not swallowed');
});

test('US-14-R04: the script never prints the tick token and runs the model-port check before it deploys', () => {
  assert.ok(!/echo[^\n]*\$TOKEN|echo[^\n]*\$\{TOKEN/.test(script), 'no echo of the token');
  const check = script.indexOf('core/modelport/cli.js'); assert.ok(check > 0, 'the model-port check is in the script');
  assert.ok(check < script.indexOf('gcloud run deploy'), 'and runs before the deploy');
  assert.equal(spawnSync('bash', ['-n', here('../deploy.sh')], { encoding: 'utf8' }).status, 0, 'the script parses');
});

test('US-14-R03: the CronJob manifest forbids concurrent ticks, runs every ten minutes and reads the token from a secret, never from the manifest', () => {
  assert.equal(cron.kind, 'CronJob'); assert.equal(cron.spec.schedule, '*/10 * * * *'); assert.equal(cron.spec.concurrencyPolicy, 'Forbid');
  assert.ok(cron.spec.startingDeadlineSeconds > 0);
  const c = cron.spec.jobTemplate.spec.template.spec.containers[0];
  const t = c.env.find(e => e.name === 'TICK_TOKEN');
  assert.ok(t.valueFrom.secretKeyRef.name && !('value' in t), 'the token comes from a secret reference');
  assert.ok(c.args.includes('POST') && c.args.some(a => /X-Tick-Token: \$\(TICK_TOKEN\)/.test(a)) && c.args.some(a => /\/tick$/.test(a)));
  assert.ok(cron.spec.jobTemplate.spec.activeDeadlineSeconds <= 600, 'a stuck job is stopped before the next slot rotation');
  assert.ok(!/\b(crontab|systemd|systemctl|launchd|localhost)\b/i.test(JSON.stringify(cron)), 'no word the server-side rule bans');
});

// ---- the script run for real against fake gcloud and curl (no network, no account): what it calls, in what order, and when it stops ----------------------
const ROOT = here('../../../'); // workers/
const family = (n, fam) => ({ endpoint: `e-${n}`, model: n, family: fam, key_env: `KEY_${n.toUpperCase()}` });
const goodCfg = { modelport: { aliases: { medium: family('a', 'fam-a'), large: family('b', 'fam-b') }, roles: { doer: 'medium', reviewer: 'large' } } };
const badCfg = { modelport: { aliases: { medium: family('a', 'fam-a'), large: family('b', 'fam-b') }, roles: { doer: 'medium', reviewer: 'medium' } } };

function runScript({ config = null, curlFails = null, existing = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-deploy-'));
  try {
    const log = path.join(dir, 'calls.log'); const bin = path.join(dir, 'bin'); const cfgFile = path.join(dir, 'cfg.json');
    spawnSync('mkdir', ['-p', bin]);
    writeFileSync(path.join(bin, 'gcloud'), `#!/usr/bin/env bash
echo "gcloud $*" >> "${log}"
cat > /dev/null < /dev/stdin 2>/dev/null || true
case "$*" in
  *"services describe"*) echo https://svc-abc.run.app;;
  *"versions access"*) echo fake-token-value;;
  *"projects describe"*) echo 123456789;;
  *"print-access-token"*) echo fake-access;;
esac
`);
    const listed = existing ? `{"uptimeCheckConfigs":[{"displayName": "ultrastable-tick-health"}]}` : '{}';
    const curlBody = `case "$*" in *-X*) echo '{}';; *) echo '${listed}';; esac`;
    writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
echo "curl $*" >> "${log}"
${curlFails ? `case "$*" in *${curlFails}*) echo "curl: (22) The requested URL returned error: 403" >&2; exit 22;; esac` : ''}
${curlBody}
`);
    for (const f of ['gcloud', 'curl']) chmodSync(path.join(bin, f), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROJECT: 'proj', ORG: 'acme' };
    delete env.ULTRASTABLE_CONFIG;
    if (config) { writeFileSync(cfgFile, JSON.stringify(config)); env.ULTRASTABLE_CONFIG = cfgFile; }
    const r = spawnSync('bash', [here('../deploy.sh')], { cwd: ROOT, env, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('US-14-R16: with a config whose keys live in Secret Manager the check passes without any key in the deploying shell, and the deploy goes on', () => {
  const r = runScript({ config: goodCfg });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.calls, /gcloud run deploy ultrastable-tick/);
});

test('US-14-R16: a config whose reviewer and doer share a family stops the script before any gcloud deploy call', () => {
  const r = runScript({ config: badCfg });
  assert.notEqual(r.status, 0);
  assert.ok(!/run deploy/.test(r.calls), 'nothing was deployed');
  assert.match(r.stdout, /reviewer and doer both resolve to family fam-a/);
});

test('US-14-R16: with no config the check is skipped and the script says so on stderr (the start-up check of the revision is then the only one)', () => {
  const r = runScript();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /model-port check skipped: ULTRASTABLE_CONFIG is not set/);
});

test('US-14-R03 and US-14-R16: the uptime check is created with the service-agent OIDC token after the invoker binding; a refused creation stops the script with a non-zero status', () => {
  const ok = runScript({ config: goodCfg });
  const calls = ok.calls.split('\n');
  const bind = calls.findIndex(l => /run services add-iam-policy-binding[^\n]*gcp-sa-monitoring-notification[^\n]*roles\/run\.invoker/.test(l));
  const post = calls.findIndex(l => /^curl[^\n]*-X POST[^\n]*uptimeCheckConfigs/.test(l));
  assert.ok(bind > 0 && post > bind, 'the invoker binding comes before the check is created');
  assert.match(calls[post], /OIDC_TOKEN/); assert.match(calls[post], /"path":"\/health"/);
  const refused = runScript({ config: goodCfg, curlFails: '-X' });
  assert.notEqual(refused.status, 0, 'a refused creation is not swallowed'); assert.match(refused.stderr, /403/);
  const again = runScript({ config: goodCfg, existing: true });
  assert.equal(again.status, 0, again.stderr); assert.ok(!/-X POST/.test(again.calls), 'an existing check is not created twice');
});
