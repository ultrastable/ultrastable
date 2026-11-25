// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STANDARDS-FIRST-1 (Rowan, 2026-11-25): "Standards, don't reinvent the wheel." Events between loops are CloudEvents 1.0 (CNCF), JSON format.
// One envelope for every Worker; the Python twin is foundation/cloudevents.py and both pass the vectors in seed/standards/cloudevents-vectors.json.
//
//   cloudEvent({ area, event, source, subject, data, id, time })   a conformant envelope; type is io.ultrastable.<area>.<event>
//   conforms(e)                                                    every way e breaks the spec's REQUIRED and typed OPTIONAL attributes ([] = conformant)
//   unwrap(row)                                                    the payload of an envelope, or the row itself when it predates the envelope
export const SPECVERSION = '1.0';
export const TYPE_PREFIX = 'io.ultrastable.';
const NAME = /^[a-z0-9]+$/;                       // attribute naming: lower-case letters and digits only
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CORE = ['specversion', 'id', 'source', 'type', 'datacontenttype', 'dataschema', 'subject', 'time', 'data', 'data_base64'];
const part = s => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

export function eventType(area, event) {
  const a = part(area), ev = String(event).split('.').map(part).filter(Boolean).join('.');
  if (!a || !ev) throw new Error('a CloudEvent type needs an area and an event');
  return TYPE_PREFIX + a + '.' + ev;
}
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
// The synchronous builder the loops use: an io.ultrastable.<area>.<event> envelope with a fresh id, refused when it does not conform.
export function envelope({ area, event, type, source, subject, data, id, time, dataschema, extensions } = {}) {
  const e = { specversion: SPECVERSION, id: String(id || newId()), source: String(source || ''), type: type || eventType(area, event) };
  if (subject != null && subject !== '') e.subject = String(subject);
  e.time = typeof time === 'number' ? new Date(time).toISOString() : (time || new Date().toISOString());
  if (dataschema) e.dataschema = dataschema;
  for (const [k, v] of Object.entries(extensions || {})) e[k] = v;
  if (data !== undefined) { e.datacontenttype = 'application/json'; e.data = data; }
  const bad = conforms(e);
  if (bad.length) throw new Error('not a CloudEvent: ' + bad.join('; '));
  return e;
}
export function conforms(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['an event is a JSON object'];
  const bad = [];
  if (e.specversion !== SPECVERSION) bad.push('specversion must be "1.0"');
  for (const k of ['id', 'source', 'type']) if (typeof e[k] !== 'string' || !e[k]) bad.push(k + ' must be a non-empty string');
  if (typeof e.source === 'string' && /\s/.test(e.source)) bad.push('source must be a URI-reference');
  for (const k of ['datacontenttype', 'dataschema', 'subject']) if (k in e && (typeof e[k] !== 'string' || !e[k])) bad.push(k + ' must be a non-empty string when present');
  if ('time' in e && !(typeof e.time === 'string' && RFC3339.test(e.time))) bad.push('time must be an RFC 3339 timestamp');
  if ('data' in e && 'data_base64' in e) bad.push('data and data_base64 are exclusive');
  for (const [k, v] of Object.entries(e)) {
    if (!NAME.test(k) && k !== 'data_base64') bad.push('attribute name ' + k + ' must be lower-case letters and digits');
    else if (!CORE.includes(k) && !['string', 'number', 'boolean'].includes(typeof v)) bad.push('extension attribute ' + k + ' must be a string, number or boolean');
  }
  return bad;
}
export const isCloudEvent = r => Boolean(r && typeof r === 'object' && r.specversion === SPECVERSION && typeof r.type === 'string' && typeof r.id === 'string');
export const unwrap = r => (isCloudEvent(r) && r.type.startsWith(TYPE_PREFIX) && r.data && typeof r.data === 'object' ? r.data : r);

// OPEN-STANDARDS-1 names from the standards kit, kept as one module: the same checks under the kit's names, and the structured-mode HTTP form.
export const SPEC_VERSION = SPECVERSION;
export const CONTENT_TYPE = 'application/cloudevents+json';
const ATTR = /^[a-z0-9]{1,20}$/;
/** Errors against CloudEvents 1.0 core requirements; empty when the event conforms. */
export function cloudEventErrors(ev) {
  const bad = [];
  for (const k of ['specversion', 'id', 'source', 'type']) if (!ev || !ev[k]) bad.push(`missing ${k}`);
  if (ev && ev.specversion && ev.specversion !== SPECVERSION) bad.push(`specversion must be ${SPECVERSION}`);
  if (ev && ev.time && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(ev.time))) bad.push('time must be RFC 3339');
  for (const k of Object.keys(ev || {})) if (!ATTR.test(k)) bad.push(`attribute name ${k} is not a valid CloudEvents name`);
  return bad;
}
const hex = async (x) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
};
/** OPEN-STANDARDS-1: build any CloudEvent with a stable id (the same event built twice has one id). type is reverse-DNS; source is a URI reference. */
export async function cloudEvent({ type, source, data, subject, id, time, dataschema, datacontenttype = 'application/json', ...ext }) {
  const t = time || new Date().toISOString();
  const ev = { specversion: SPECVERSION, id: id || (await hex(`${type}|${source}|${subject || ''}|${t}|${JSON.stringify(data ?? null)}`)), source, type, time: t };
  if (subject) ev.subject = subject;
  if (data !== undefined) { ev.datacontenttype = datacontenttype; ev.data = data; }
  if (dataschema) ev.dataschema = dataschema;
  for (const [k, v] of Object.entries(ext)) {
    if (!ATTR.test(k)) throw new Error(`CloudEvents extension names are lower-case alphanumerics: ${k}`);
    if (v !== undefined) ev[k] = v;
  }
  return ev;
}
/** Structured-mode HTTP body and headers for sending one event. */
export const toHttp = (ev) => ({ headers: { 'content-type': CONTENT_TYPE }, body: JSON.stringify(ev) });
