// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// videoChannel over the YouTube Data API v3 (resumable upload), the JS counterpart of seed/plugins/youtube/plugin.py. fetch and readAsset
// are injected; the OAuth client id, secret and refresh token are read from env by NAME at call time and never put in a URL, a log or an
// error. Safety property carried over from the plugin tier (US-21-R24): an upload is always private or unlisted. A request for public
// is refused here; releasing a video to the public is a decision card for a person, never a channel action.
// Provenance travels in the description (a `Provenance:` line carrying the hash) so the verify loop can read it back.
export const SECRET_NAMES = ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const PROV = /(?:^|\n)Provenance:\s*([0-9a-f]{16,64})\s*$/;

export function createYoutubeChannel({ fetch, env = {}, readAsset, privacy = 'private', names = SECRET_NAMES } = {}) {
  if (typeof fetch !== 'function') throw new Error('fetch must be injected');
  if (!['private', 'unlisted'].includes(privacy)) throw new Error('uploads are private or unlisted; public release is a decision card for a person');
  const [idEnv, secretEnv, refreshEnv] = names;
  let access = null;

  const fail = (what, res, data) => Object.assign(new Error(`${what} failed: HTTP ${res.status}${typeof data?.error?.status === 'string' ? ` ${data.error.status.replace(/[^A-Z_]/g, '').slice(0, 40)}` : ''}`), { status: res.status });
  async function token() {
    if (access) return access;
    const missing = names.filter(n => !env[n]);
    if (missing.length) throw new Error(`credentials missing: ${missing.join(', ')}`);
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: env[idEnv], client_secret: env[secretEnv], refresh_token: env[refreshEnv], grant_type: 'refresh_token' }) });
    let data = null; try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok || !data?.access_token) throw fail('token refresh', res, data);
    access = data.access_token; return access;
  }
  async function get(path, query) {
    const res = await fetch(`${API}/${path}?${new URLSearchParams(query)}`, { method: 'GET', headers: { authorization: `Bearer ${await token()}`, accept: 'application/json' } });
    let data = null; try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw fail(path, res, data);
    return data;
  }

  return {
    name: 'youtube',
    // US-21-R25: read-only. Refreshes the token and reads the authorized channel.
    async probe() { const d = await get('channels', { part: 'id', mine: 'true' }); if (!d?.items?.length) throw new Error('no channel is authorized'); return { ok: true, detail: 'channel readable' }; },
    async publish({ title, description, assetRef, provenanceHash, privacy: asked }) {
      if (asked && asked !== privacy) throw new Error(`privacy ${asked} refused: uploads are ${privacy}; public release is a decision card for a person`);
      if (typeof readAsset !== 'function') throw new Error('readAsset must be injected');
      const bytes = await readAsset(assetRef);
      if (!bytes) throw new Error('asset not found');
      const auth = `Bearer ${await token()}`;
      const body = { snippet: { title, description: `${description}\n\nProvenance: ${provenanceHash}` }, status: { privacyStatus: privacy } };
      const init = await fetch(UPLOAD, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const loc = init.ok && init.headers && init.headers.get ? init.headers.get('location') : null;
      if (!init.ok || !loc || !/^https:\/\//.test(loc)) throw fail('upload init', init, null);
      const up = await fetch(loc, { method: 'PUT', headers: { authorization: auth, 'content-type': 'video/*' }, body: bytes });
      let data = null; try { data = await up.json(); } catch { /* empty body */ }
      if (!up.ok || !data?.id) throw fail('upload', up, data);
      return { id: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
    },
    async fetchVideo(id) {
      const d = await get('videos', { part: 'snippet,status,statistics', id });
      const v = d?.items?.[0];
      if (!v) return null;
      const st = v.status?.uploadStatus;
      return {
        id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, privacy: v.status?.privacyStatus,
        state: st === 'processed' ? 'published' : st === 'uploaded' || st === 'processing' ? 'processing' : 'failed',
        provenanceHash: PROV.exec(String(v.snippet?.description || ''))?.[1], views: Number(v.statistics?.viewCount || 0),
      };
    },
  };
}
