// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The model-port deploy check as a command (US-14-R10, R16): `node core/modelport/cli.js <config.json> [--endpoints a,b] [--keys-declared] [--present A,B]`.
// The config is either a modelport block ({ aliases, roles }) or a whole organisation config with a `modelport` key. It prints the
// result of deployCheck() as JSON and exits 1 when there are errors, so CI and a deploy script refuse to ship a revision whose reviewer
// and doer resolve to one family while two are available. Endpoints named by an alias count as available unless --endpoints lists
// the ones the host really has; key presence is read from the environment as names only, never a value (US-14-R04). A deploy script whose
// keys live in the host's secret store passes --keys-declared (every key_env an alias names counts as present) or --present A,B (those names
// count); the host's own start-up check then reads the real presence, so a deploy never needs a key value in the deploying shell.
// This is an entry point, not core logic: it is the one file in core/modelport that touches node: and process, and is listed in the
// purity baseline (adapters/shared/purity-baseline.json) with that reason.
import { readFileSync } from 'node:fs';
import { createModelPort } from './index.js';

/** Pure: the deploy check for a config, an environment presence map and the names of the endpoints the host offers (null = every named one). */
export function checkConfig(config, env = {}, endpointNames = null) {
  const block = config?.modelport || config || {};
  const named = [...new Set(Object.values(block.aliases || {}).map(a => a?.endpoint).filter(Boolean))];
  const offered = endpointNames ?? named;
  const endpoints = Object.fromEntries(offered.map(n => [n, async () => ({ text: '', tokens_in: 0, tokens_out: 0 })]));
  const presence = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, typeof v === 'string' ? v !== '' : v != null && v !== false]));
  return createModelPort({ config: block, endpoints, env: presence }).deployCheck();
}

export function main(argv = process.argv.slice(2), env = process.env, out = s => process.stdout.write(s + '\n')) {
  const pi0 = argv.indexOf('--present'), ei0 = argv.indexOf('--endpoints');
  const file = argv.find((a, i) => !a.startsWith('--') && (pi0 < 0 || i !== pi0 + 1) && (ei0 < 0 || i !== ei0 + 1));
  const at = argv.indexOf('--endpoints');
  if (!file) { out(JSON.stringify({ ok: false, errors: ['usage: node core/modelport/cli.js <config.json> [--endpoints a,b]'], warnings: [] })); return 2; }
  let config;
  try { config = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { out(JSON.stringify({ ok: false, errors: [`cannot read ${file}: ${String(e.message).slice(0, 120)}`], warnings: [] })); return 2; }
  const pi = argv.indexOf('--present');
  const extra = pi >= 0 && argv[pi + 1] ? argv[pi + 1].split(',').filter(Boolean) : [];
  if (argv.includes('--keys-declared')) for (const a of Object.values((config?.modelport || config || {}).aliases || {})) if (a?.key_env) extra.push(a.key_env);
  env = { ...env, ...Object.fromEntries(extra.map(k => [k, 'declared'])) };
  const names = at >= 0 && argv[at + 1] ? argv[at + 1].split(',').filter(Boolean) : null;
  const r = checkConfig(config, env, names);
  out(JSON.stringify(r));
  return r.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
