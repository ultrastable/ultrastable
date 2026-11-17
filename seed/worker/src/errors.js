// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// USER-BACKEND-1 (Rowan, 2026-11-17): the user does their idea and their front end; the system does everything behind it (errors,
// credentials, deploys, identity, retries). Backend detail is recorded for the owner-only audit log and never reaches a user-facing
// response. Every Worker (site, dashboard, tenants, spinoffs, the seed tick) imports this one module; a copy is a defect that
// `python3 -m foundation userbackend --check` fails.
//
//   say(message, status)           an error whose text is written for people: the only kind that may reach a user as is
//   plain(e)                       { code, status, message } safe to send to a user, whatever e is
//   userError(e, where, opts)      records the full backend detail (console + opts.audit) and returns plain(e) as { ok:false, code, error }
//   userJson(e, where, opts)       the same as a JSON Response
//   backendRecord(e, where, opts)  record only
export class UserFacing extends Error {
  constructor(message, status = 400, code = 'bad_request') { super(message); this.userSafe = true; this.status = status; this.code = code; }
}
export const say = (message, status = 400, code) => new UserFacing(message, status, code);

const WORDS = {
  limit: ['The service is resting until its daily allowance resets. Nothing is lost; it continues by itself.', 503],
  timeout: ['That took too long. The system will try again by itself.', 504],
  network: ['A connection did not answer. The system will try again by itself.', 502],
  auth: ['Please sign in again.', 401],
  not_found: ['That could not be found.', 404],
  bad_request: ['That could not be used. Please check it and try again.', 400],
  internal: ['Something went wrong on our side. The system has recorded it and will retry by itself.', 500],
};
const raw = e => String((e && (e.message || e.stack)) || e || '');
export function classify(e) {
  if (e && e.userSafe) return e.code || 'bad_request';
  const m = raw(e);
  if (/free tier|row read limit|7500|exceeded|quota|rate.?limit|too many requests/i.test(m)) return 'limit';
  if (/timed? ?out|timeout|aborted/i.test(m)) return 'timeout';
  if (/fetch failed|network|ECONN|ENOTFOUND|socket|dns|unreachable/i.test(m)) return 'network';
  if (/unauthori[sz]ed|forbidden|expired token|bad credentials|401|403/i.test(m)) return 'auth';
  return 'internal';
}
// opts.fallback = { code, status, message }: for a surface whose unexpected errors are the caller's input failing (a rejected sign-in), not an outage.
export function plain(e, opts = {}) {
  if (e && e.userSafe) return { code: e.code || 'bad_request', status: e.status || 400, message: String(e.message).slice(0, 240) };
  const code = classify(e);
  if (opts.fallback && code === 'internal') return { code: opts.fallback.code, status: opts.fallback.status, message: opts.fallback.message };
  const [message, status] = WORDS[code] || WORDS.internal;
  return { code, status, message };
}
export function backendRecord(e, where = 'unknown', opts = {}) {
  const rec = { at: new Date().toISOString(), where, code: classify(e), detail: raw(e).slice(0, 600), user_safe: Boolean(e && e.userSafe) };
  try { console.error('backend_error', JSON.stringify(rec)); } catch (_) { /* allow-silent: the console itself failed; the audit hook below still records it */ }
  if (typeof opts.audit === 'function') Promise.resolve().then(() => opts.audit(rec)).catch(x => console.error('backend_error audit failed', raw(x).slice(0, 160)));
  return rec;
}
export function userError(e, where, opts = {}) {
  backendRecord(e, where, opts);
  const p = plain(e, opts);
  return { ok: false, code: p.code, error: p.message, status: p.status };
}
export function userJson(e, where, opts = {}) {
  const { status, ...body } = userError(e, where, opts);
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
