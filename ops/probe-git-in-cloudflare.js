// GIT-IN-CLOUDFLARE-1 probe: does Cloudflare's Git-compatible storage support clone/commit/push?
// Run from a Worker (wrangler dev or deployed). Writes ops/git-in-cloudflare-evidence.json on success.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function runProbe(env) {
  const evidence = { item: 'GIT-IN-CLOUDFLARE-1', date: new Date().toISOString(), steps: {} };
  const tryStep = (name, fn) => {
    try { fn(); evidence.steps[name] = 'ok'; }
    catch (e) { evidence.steps[name] = 'fail: ' + String(e.message || e); }
  };
  const storagePath = env.GIT_STORAGE_PATH || '/git/repo.git';
  const mirrorUrl = env.GITHUB_MIRROR_URL; // https://<token>@github.com/<org>/<repo>.git

  tryStep('init-bare', () => execSync(`git init --bare ${storagePath}`, { stdio: 'pipe' }));
  tryStep('clone', () => execSync(`git clone ${storagePath} /tmp/work`, { stdio: 'pipe' }));
  tryStep('commit', () => {
    fs.writeFileSync('/tmp/work/probe.txt', 'probe ' + evidence.date + '\n');
    execSync('git -C /tmp/work add probe.txt && git -C /tmp/work commit -m probe', { stdio: 'pipe' });
  });
  tryStep('push-to-storage', () => execSync('git -C /tmp/work push origin HEAD', { stdio: 'pipe' }));
  if (mirrorUrl) {
    tryStep('push-to-github-mirror', () =>
      execSync(`git -C /tmp/work push ${mirrorUrl} HEAD:main`, { stdio: 'pipe' }));
  }
  evidence.githubIsMaster = true; // per owner direction 2026-11-13: GitHub stays master; loops must not depend on it
  fs.mkdirSync('ops', { recursive: true });
  fs.writeFileSync('ops/git-in-cloudflare-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
