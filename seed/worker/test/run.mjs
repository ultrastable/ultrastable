// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SEED-SELFCONTAINED-1: a fresh seed checkout runs green on its own. Tests that mirror files only the Ultrastable monorepo holds (deploy/, doctrine/,
// brand/, site/, platform/) run there and are skipped here by name, listed in monorepo-only.json; nothing is skipped when those files exist.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const here = new URL('.', import.meta.url).pathname;
const mono = existsSync(new URL('../../../foundation/__init__.py', import.meta.url));
const only = JSON.parse(readFileSync(here + 'monorepo-only.json', 'utf8'));
const files = readdirSync(here).filter(f => f.endsWith('.test.js') && (mono || !only.files.includes(f))).map(f => 'test/' + f);
const args = ['--test', '--no-warnings', ...(mono ? [] : only.tests.flatMap(t => ['--test-skip-pattern', t])), ...files];
if (!mono) console.log(`seed checkout: skipping ${only.files.length} monorepo-only files and ${only.tests.length} tests (monorepo-only.json)`);
process.exit(spawnSync(process.execPath, args, { stdio: 'inherit', cwd: here + '..' }).status ?? 1);
