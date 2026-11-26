// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the YouTube video channel (US-21-R24, R10, R25): private or unlisted only, provenance in the description, no network, no secret
// in an error. Fake fetch and a fake asset reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeChannel, guardPort } from './index.js';

const ENV = { YT_CLIENT_ID: 'cid-12345678', YT_CLIENT_SECRET: 'csecret-12345678', YT_REFRESH_TOKEN: 'refresh-12345678' };
function fakeFetch({ videos = new Map(), failUpload = false, failToken = false } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    url = String(url); const body = typeof init.body === 'string' && init.headers?.['content-type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method, headers: init.headers || {}, body });
    const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return failToken ? J({ error: { message: 'bad refresh-12345678' } }, 400) : J({ access_token: 'access-tok-abcdef' });
    if (url.startsWith('https://www.googleapis.com/upload/')) return failUpload ? J({}, 500) : J({}, 200, { location: 'https://upload.example.com/session/1' });
    if (url === 'https://upload.example.com/session/1') { const id = `vid${videos.size + 1}`; videos.set(id, calls.find(c => c.url.includes('/upload/')).body); return J({ id }); }
    if (url.includes('/youtube/v3/channels')) return J({ items: [{ id: 'UC1' }] });
    if (url.includes('/youtube/v3/videos')) { const id = new URL(url).searchParams.get('id'); const v = videos.get(id); return J({ items: v ? [{ id, status: { uploadStatus: 'processed', privacyStatus: v.status.privacyStatus }, snippet: { description: v.snippet.description }, statistics: { viewCount: '7' } }] : [] }); }
    return J({}, 404);
  };
  f.calls = calls;
  return f;
}
const VIDEO = { title: 'Demo', description: 'A short demo. AI-generated.', assetRef: 'r2://demo.mp4', provenanceHash: 'a'.repeat(64) };
const readAsset = async ref => (ref === 'r2://demo.mp4' ? new Uint8Array([1, 2, 3]) : null);

test('US-21-R24: the youtube channel sends private or unlisted and refuses public; the default is private', async () => {
  const fetch = fakeFetch();
  const ch = createYoutubeChannel({ fetch, env: ENV, readAsset });
  const r = await ch.publish(VIDEO);
  assert.deepEqual(r, { id: 'vid1', url: 'https://www.youtube.com/watch?v=vid1' });
  const init = fetch.calls.find(c => c.url.includes('/upload/'));
  assert.equal(init.body.status.privacyStatus, 'private');
  assert.match(init.body.snippet.description, /Provenance: a{64}$/);
  assert.equal(fetch.calls.at(-1).method, 'PUT'); assert.equal(fetch.calls.at(-1).headers.authorization, 'Bearer access-tok-abcdef');
  await assert.rejects(() => ch.publish({ ...VIDEO, privacy: 'public' }), /privacy public refused/);
  assert.equal(fetch.calls.filter(c => c.url.includes('/upload/')).length, 1, 'a public request sent nothing');
  assert.throws(() => createYoutubeChannel({ fetch, env: ENV, readAsset, privacy: 'public' }), /private or unlisted/);
  const unlisted = createYoutubeChannel({ fetch, env: ENV, readAsset, privacy: 'unlisted' });
  await unlisted.publish(VIDEO);
  assert.equal(fetch.calls.filter(c => c.url.includes('/upload/')).at(-1).body.status.privacyStatus, 'unlisted');
});

test('US-21-R10: the youtube channel runs without network and never puts a credential in an error or a URL', async () => {
  const none = createYoutubeChannel({ fetch: fakeFetch(), env: {}, readAsset });
  await assert.rejects(() => none.publish(VIDEO), /credentials missing: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN/);
  const badTok = createYoutubeChannel({ fetch: fakeFetch({ failToken: true }), env: ENV, readAsset });
  await assert.rejects(() => badTok.publish(VIDEO), e => /token refresh failed: HTTP 400/.test(e.message) && !e.message.includes('refresh-12345678'));
  const f = fakeFetch({ failUpload: true });
  await assert.rejects(() => createYoutubeChannel({ fetch: f, env: ENV, readAsset }).publish(VIDEO), /upload init failed: HTTP 500/);
  assert.ok(!f.calls.some(c => /csecret|refresh-1234|cid-1234/.test(c.url)), 'no credential in any URL');
  await assert.rejects(() => createYoutubeChannel({ fetch: fakeFetch(), env: ENV, readAsset: async () => null }).publish(VIDEO), /asset not found/);
  assert.throws(() => createYoutubeChannel({ env: ENV }), /fetch must be injected/);
});

test('US-21 s7 video: fetchVideo reads the state and the provenance hash back; a missing video is null', async () => {
  const videos = new Map(); const fetch = fakeFetch({ videos });
  const ch = createYoutubeChannel({ fetch, env: ENV, readAsset });
  const { id } = await ch.publish(VIDEO);
  const v = await ch.fetchVideo(id);
  assert.deepEqual([v.state, v.provenanceHash, v.views, v.privacy], ['published', 'a'.repeat(64), 7, 'private']);
  assert.equal(await ch.fetchVideo('nope'), null);
});

test('US-21-R25: the youtube probe reads the channel and never uploads; the guard port forwards it', async () => {
  const fetch = fakeFetch();
  const ch = createYoutubeChannel({ fetch, env: ENV, readAsset });
  assert.deepEqual(await ch.probe(), { ok: true, detail: 'channel readable' });
  assert.ok(!fetch.calls.some(c => c.url.includes('/upload/') || c.method === 'PUT'));
  assert.equal(typeof guardPort({ db: {}, channel: ch }).probe, 'function');
});
