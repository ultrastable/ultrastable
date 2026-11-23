// SPDX-License-Identifier: LicenseRef-Ultrastable
import { test } from "node:test";
import assert from "node:assert";
import { CASES, GRADES, VERDICTS } from "./cases.js";
import w, { beat, health } from "./index.js";
function fakeDb() { const rows = { beats: [] }; return { rows, prepare(sql) { let a = []; return { bind(...x) { a = x; return this; }, async run() { if (sql.startsWith("INSERT INTO beats")) rows.beats.push({ at: a[0], checked: a[1], ok: a[2] }); }, async first() { return rows.beats.at(-1) || null; } }; } }; }
test("every case has an aim, a verdict and graded, linked evidence", () => {
  assert.ok(CASES.length >= 8);
  for (const c of CASES) { assert.ok(c.aim && VERDICTS[c.verdict] && c.evidence.length); for (const e of c.evidence) { assert.ok(GRADES[e.design]); assert.match(e.url, /^https:\/\//); } }
});
test("the beat checks every source and health turns looping", async () => {
  const env = { DB: fakeDb() };
  assert.equal((await health(env)).stage, "live");
  const r = await beat(env, async () => ({ status: 200 }));
  assert.equal(r.checked, CASES.reduce((n, c) => n + c.evidence.length, 0));
  assert.equal((await health(env)).stage, "looping");
});
test("home page asks for a guess before showing the answer", async () => {
  const html = await (await w.fetch(new Request("https://x/"), { DB: fakeDb() })).text();
  assert.match(html, /Your guess/); assert.match(html, /class=r/);
});
