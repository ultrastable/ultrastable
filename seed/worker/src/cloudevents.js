// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// OPEN-STANDARDS-1 (Rowan 2026-11-25): "Standards, don't reinvent the wheel." CloudEvents 1.0 (JSON event format) is the one
// envelope for events between loops, workers, tenants and webhooks. Python twin: seed/scripts/openstd.py (cloudevent).
// Ultrastable is the foundation for any autonomous system.
export const SPEC_VERSION = '1.0';
export const CONTENT_TYPE = 'application/cloudevents+json';
const NAME = /^[a-z0-9]{1,20}$/;

const hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
};

/** Build a CloudEvent. type is reverse-DNS (io.ultrastable.<loop>.<what>); source is a URI reference. */
export async function cloudEvent({ type, source, data, subject, id, time, dataschema, datacontenttype = 'application/json', ...ext }) {
  const t = time || new Date().toISOString();
  const ev = { specversion: SPEC_VERSION, id: id || (await hex(`${type}|${source}|${subject || ''}|${t}|${JSON.stringify(data ?? null)}`)), source, type, time: t };
  if (subject) ev.subject = subject;
  if (data !== undefined) { ev.datacontenttype = datacontenttype; ev.data = data; }
  if (dataschema) ev.dataschema = dataschema;
  for (const [k, v] of Object.entries(ext)) {
    if (!NAME.test(k)) throw new Error(`CloudEvents extension names are lower-case alphanumerics: ${k}`);
    if (v !== undefined) ev[k] = v;
  }
  return ev;
}

/** Errors against CloudEvents 1.0 core requirements; empty when the event conforms. */
export function cloudEventErrors(ev) {
  const bad = [];
  for (const k of ['specversion', 'id', 'source', 'type']) if (!ev || !ev[k]) bad.push(`missing ${k}`);
  if (ev && ev.specversion && ev.specversion !== SPEC_VERSION) bad.push(`specversion must be ${SPEC_VERSION}`);
  if (ev && ev.time && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(ev.time))) bad.push('time must be RFC 3339');
  for (const k of Object.keys(ev || {})) if (!NAME.test(k)) bad.push(`attribute name ${k} is not a valid CloudEvents name`);
  return bad;
}

/** Structured-mode HTTP body and headers for sending one event. */
export const toHttp = (ev) => ({ headers: { 'content-type': CONTENT_TYPE }, body: JSON.stringify(ev) });
