// GIT-IN-CLOUDFLARE-1 probe: clone repo into Cloudflare Git-compatible storage,
// commit one change, push to the GitHub mirror. Run from the Worker.
import { clone, commit, push, branch, listBranches } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import fs from './git-fs-adapter.mjs'; // Worker FS adapter over Cloudflare Git-compatible storage

const CF_GIT_URL = env.CLOUDFLARE_GIT_URL; // Git-compatible storage endpoint
const MIRROR_URL = `https://github.com/${process.env.MIRROR_REPO}.git`;
const dir = '/';

async function main() {
  await clone({ fs, http, dir, url: CF_GIT_URL, ref: 'main', singleBranch: false });
  await fs.promises.writeFile(`${dir}/ops/probe-marker.txt`, `probe ${new Date().toISOString()}\n`);
  await commit({ fs, dir, message: 'probe: GIT-IN-CLOUDFLARE-1', author: { name: 'worker', email: 'worker@loops' } });
  await branch({ fs, dir, ref: 'feature/probe', checkout: false });
  const branches = await listBranches({ fs, dir });
  await push({ fs, http, dir, url: MIRROR_URL, ref: 'main',
    onAuth: () => ({ username: 'x-access-token', password: process.env.GITHUB_TOKEN }) });
  return { branches, pushed: true };
}

main().then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); });
