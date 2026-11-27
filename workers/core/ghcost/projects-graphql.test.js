// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-24-R03: the Projects (v2) GraphQL adapter behind the three board ports, run against a fake GraphQL server through the real
// githubPort and projectMirror. No network, no real account, no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { githubPort } from './github.js';
import { projectMirror } from './projects.js';
import { projectPort } from './projects-graphql.js';

const dirs = ['./migrations/', '../deploy/migrations/'].map(d => fileURLToPath(new URL(d, import.meta.url)));
const T0 = Date.parse('2026-11-15T12:00:00Z');

// A fake of the slice of the Projects v2 API the adapter uses. Fields: Status is single-select, Program and Probe are text.
function fakeBoard({ pageSize = 100, options = ['open', 'ready', 'blocked'], noProject = false, errorOn = null, extraFields = 0, fieldsPage = 50, valuesPage = 100 } = {}) {
  const items = [], log = []; let seq = 0;
  const FIELDS = [{ id: 'F-status', name: 'Status', dataType: 'SINGLE_SELECT', options: options.map(n => ({ id: 'O-' + n, name: n })) }, { id: 'F-prog', name: 'Program', dataType: 'TEXT' }, { id: 'F-probe', name: 'Probe', dataType: 'TEXT' },
    ...Array.from({ length: extraFields }, (_, i) => ({ id: 'F-x' + i, name: 'Extra ' + i, dataType: 'TEXT' }))];
  const fetch = async (url, init) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.match(init.headers.authorization, /^Bearer /);
    const { query, variables: v } = JSON.parse(init.body); const ok = data => new Response(JSON.stringify({ data }), { status: 200 });
    if (errorOn && query.includes(errorOn)) return new Response(JSON.stringify({ errors: [{ message: 'Resource not accessible by personal access token' }] }), { status: 200 });
    if (query.includes('fields(first:50)')) return ok({ organization: { projectV2: noProject ? null : { id: 'PROJ', fields: { pageInfo: { hasNextPage: FIELDS.length > fieldsPage }, nodes: FIELDS.slice(0, fieldsPage) } } } });
    if (query.includes('items(first:')) {
      const start = v.after ? Number(v.after) : 0, slice = items.slice(start, start + pageSize);
      return ok({ organization: { projectV2: { items: { pageInfo: { hasNextPage: start + pageSize < items.length, endCursor: String(start + pageSize) }, nodes: slice.map(i => { const vals = Object.entries(i.fields); return { id: i.id, content: { title: i.title }, fieldValues: { pageInfo: { hasNextPage: vals.length > valuesPage }, nodes: vals.slice(0, valuesPage).map(([name, val]) => (name === 'Status' ? { name: val, field: { name } } : { text: val, field: { name } })) } }; }) } } } });
    }
    if (query.includes('addProjectV2DraftIssue')) { const it = { id: 'I-' + ++seq, title: v.title, fields: {} }; items.push(it); log.push('add:' + v.title); return ok({ addProjectV2DraftIssue: { projectItem: { id: it.id } } }); }
    if (query.includes('updateProjectV2ItemFieldValue')) {
      const it = items.find(i => i.id === v.item), f = FIELDS.find(x => x.id === v.field);
      it.fields[f.name] = v.option ? f.options.find(o => o.id === v.option).name : v.text; log.push(`set:${it.title}:${f.name}`);
      return ok({ updateProjectV2ItemFieldValue: { projectV2Item: { id: it.id } } });
    }
    if (query.includes('deleteProjectV2Item')) { const k = items.findIndex(i => i.id === v.item); log.push('delete:' + items[k].title); items.splice(k, 1); return ok({ deleteProjectV2Item: { deletedItemId: v.item } }); }
    throw new Error('fake board: unexpected query ' + query.slice(0, 60));
  };
  return { items, log, fetch };
}
const port = fake => githubPort({ fetch: fake.fetch, env: { VCS_TOKEN: 'tok-secret-123' }, org: 'example-org' });
const addItem = (db, id, status = 'open', disposition = null) => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, project, status, disposition) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, 't ' + id, 'work', 'ops', 'done', 'probe ' + id, 'prog', status, disposition);
const ctx = (github, extra = {}) => ({ db: makeDb(dirs), now: () => T0, github, config: { ghcost: { enabled: true, org: 'example-org', repos: ['code'], projects: { enabled: true, project: 7, ...extra } } } });

test('US-24-R03 the GraphQL adapter adds a draft issue per open ledger item, sets its three fields and reads them back as a pass', async () => {
  const fake = fakeBoard(), c = ctx(port(fake));
  addItem(c.db, 'A-1'); addItem(c.db, 'A-2', 'ready');
  const r = await projectMirror(c);
  assert.deepEqual([r.result, r.added.sort()], ['pass', ['A-1', 'A-2']]);
  assert.deepEqual(fake.items.map(i => [i.title, i.fields]), [['A-1', { Status: 'open', Program: 'prog', Probe: 'probe A-1' }], ['A-2', { Status: 'ready', Program: 'prog', Probe: 'probe A-2' }]]);
  const again = await projectMirror({ ...c, github: port(fake) });
  assert.deepEqual([again.result, again.unchanged, again.added.length], ['pass', 2, 0], 'a second read finds the board equal to the ledger');
});

test('US-24-R03 a field edited on the board is drift and the ledger value is written again; an item leaves only after its ledger item closes with a disposition', async () => {
  const fake = fakeBoard(), c = ctx(port(fake));
  addItem(c.db, 'A-1'); addItem(c.db, 'X-1');
  await projectMirror(c);
  fake.items.find(i => i.title === 'A-1').fields.Status = 'blocked';  // somebody edits the board
  c.db.raw.prepare(`UPDATE items SET status='done', disposition='fixed by test' WHERE id='X-1'`).run();
  fake.items.push({ id: 'I-foreign', title: 'Not ours', fields: {} });   // an item the ledger does not know
  const r = await projectMirror({ ...c, github: port(fake) });
  assert.deepEqual([r.result, r.drift, r.removed], ['drift', [{ item: 'A-1', fields: ['Status'] }], ['X-1']]);
  assert.equal(fake.items.find(i => i.title === 'A-1').fields.Status, 'open');
  assert.deepEqual(fake.items.map(i => i.title).sort(), ['A-1', 'Not ours'], 'the foreign item is not ours to delete');
});

test('US-24-R03 a board read in several pages is read whole, and one larger than the page bound is refused, not read in part', async () => {
  const fake = fakeBoard({ pageSize: 2 });
  for (let i = 0; i < 5; i++) fake.items.push({ id: 'I-' + i, title: 'P-' + i, fields: { Status: 'open' } });
  assert.equal((await port(fake).projectItems(7)).length, 5, 'three pages of two are one board of five');
  const graphql = async (query, variables) => (await (await fake.fetch('https://api.github.com/graphql', { headers: { authorization: 'Bearer t' }, body: JSON.stringify({ query, variables }) })).json()).data;
  await assert.rejects(() => projectPort({ graphql, org: 'example-org', maxPages: 2 }).projectItems(7), /more than 200 items; refusing a partial read/);
});

test('US-24-R03 an unreadable board is unmeasured; a missing field, a missing option, a missing project and a GraphQL error are errors, never silent skips', async () => {
  const c0 = ctx(port(fakeBoard({ errorOn: 'items(first:' })));
  addItem(c0.db, 'A-1');
  assert.equal((await projectMirror(c0)).result, 'unknown', 'a 200 answer carrying errors is a failed read');
  await assert.rejects(() => port(fakeBoard({ noProject: true })).upsertProjectItem({ project: 7, itemId: 'A', fields: { Status: 'open' } }), /project 7 was not found/);
  await assert.rejects(() => port(fakeBoard()).upsertProjectItem({ project: 7, itemId: 'A', fields: { Nope: 'x' } }), /no field named Nope/);
  await assert.rejects(() => port(fakeBoard({ options: ['open'] })).upsertProjectItem({ project: 7, itemId: 'A', fields: { Status: 'ready' } }), /no option ready/);
  await assert.rejects(() => port(fakeBoard()).projectItems('x'), /must be the project number/);
});

test('US-24-R03 the token is read by name, sent as a bearer and never appears in an error', async () => {
  const fake = fakeBoard({ errorOn: 'addProjectV2DraftIssue' });
  await assert.rejects(() => port(fake).upsertProjectItem({ project: 7, itemId: 'A', fields: {} }), e => { assert.doesNotMatch(String(e.message), /tok-secret-123/); assert.match(e.message, /graphql: Resource not accessible/); return true; });
  await assert.rejects(() => githubPort({ fetch: fake.fetch, env: {}, org: 'example-org' }).projectItems(7), /VCS_TOKEN is not set/);
});

test('US-24-R03 a field list or a value list longer than one page is refused, not read in part', async () => {
  const wide = fakeBoard({ extraFields: 48 }); // 51 fields: one more than a page of 50
  await assert.rejects(() => port(wide).upsertProjectItem({ project: 7, itemId: 'A', fields: { Status: 'open' } }), /more than 50 fields; refusing a partial read/);
  const full = fakeBoard({ extraFields: 47 }); // exactly 50 fields: one page, read whole
  assert.deepEqual(await port(full).upsertProjectItem({ project: 7, itemId: 'A', fields: { Status: 'open' } }), { id: 'I-1' });
  const busy = fakeBoard({ valuesPage: 2 });
  busy.items.push({ id: 'I-9', title: 'B-1', fields: { Status: 'open', Program: 'p', Probe: 'q' } }); // three values, a page of two
  await assert.rejects(() => port(busy).projectItems(7), /item B-1 of project 7 has more than 100 field values; refusing a partial read/);
});
