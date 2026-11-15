import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { syncIssues, parseRoadmapIssue } from '../src/issuesync.js';

const file = (o) => ({ content: Buffer.from(JSON.stringify(o)).toString('base64') });
const issue = (id, over = {}) => ({ id, title: `ROADMAP-1: ${id}`, body: `code-task: repo=ultrastable path=x.js\n\n**Owner:** product-manager\n**Program:** PROGRAM.REACH\n**Metric it should move:** readers\n**Done check:** merged and verified live\n**Status:** open\n\nBody`, labels: ['roadmap'], milestone: 'Next', ...over });
function gh(files) {
  const calls = [];
  const f = async (url) => {
    const p = url.replace('https://api.github.com', ''); calls.push(p);
    let status = 200, body;
    if (p.startsWith('/repos/o/r/contents/docs/issues?')) body = Object.keys(files).map(n => ({ name: n }));
    else { const n = decodeURIComponent(p.split('/contents/docs/issues/')[1].split('?')[0]); if (files[n]) body = file(files[n]); else { status = 404; body = {}; } }
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}

test('parseRoadmapIssue: only open roadmap files with a done check become items', () => {
  assert.equal(parseRoadmapIssue('a.json', JSON.stringify(issue('ROADMAP-X'))).item.owner_role, 'product-manager');
  assert.equal(parseRoadmapIssue('a.json', JSON.stringify(issue('ROADMAP-X', { labels: ['x'] }))).skip, 'no roadmap label');
  assert.equal(parseRoadmapIssue('a.json', JSON.stringify(issue('ROADMAP-X', { body: '**Done check:** y\n**Status:** done' }))).skip, 'not open');
  assert.equal(parseRoadmapIssue('a.json', JSON.stringify(issue('ROADMAP-X', { body: '**Status:** open' }))).skip, 'no done check');
  assert.equal(parseRoadmapIssue('a.json', 'nope').skip, 'not json');
});

test('syncIssues: inserts new roadmap items as open, idempotent, bounded per tick, no model call', async () => {
  const db = makeDb();
  const files = {}; for (let i = 1; i <= 7; i++) files[`ROADMAP-T${i}.json`] = issue(`ROADMAP-T${i}`);
  files['ROADMAP-DONE.json'] = issue('ROADMAP-DONE', { body: '**Done check:** x\n**Status:** done' }); files['Q-OTHER.json'] = issue('Q-OTHER');
  const { f } = gh(files);
  let r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f, max: 5 });
  assert.equal(r.inserted.length, 5); assert.equal(r.status, 'ok');
  const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind('ROADMAP-T1').first();
  assert.equal(row.status, 'open'); assert.equal(row.kind, 'roadmap'); assert.match(row.surface, /PROGRAM\.REACH metric:readers/);
  r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f, max: 5 });
  assert.equal(r.inserted.length, 2, 'the remaining two, nothing twice');
  r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f, max: 5 });
  assert.deepEqual(r.inserted, []); assert.ok(r.skipped.some(s => /ROADMAP-DONE.*not open/.test(s)));
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'Q-OTHER%'").first()).n, 0, 'only ROADMAP-* files sync');
});

test('syncIssues: no token touches nothing; a failed listing is reported, never swallowed', async () => {
  const db = makeDb();
  assert.equal((await syncIssues({ db, token: '', repo: 'o/r' })).status, 'no-token');
  const f = async () => ({ ok: false, status: 502, text: async () => '{}' });
  const r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f }); assert.equal(r.status, 'errors'); assert.match(r.errors[0], /502/);
});
