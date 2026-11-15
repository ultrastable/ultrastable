// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// POINT-AND-CLICK-1: the one reusable consent screen. Whenever an authorization is needed, the product serves this screen: what is about to happen, why, and one Authorize button that goes
// to the provider's own screen. Everything after the click (callback, token exchange, storage, refresh, verification) is the system's. No screen asks for a token, a secret or a setting.
import { html } from '../ui.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// spec: { provider, title, will: [what the system will do], why, action: { url, method, fields }, button }
export function consentScreen(spec) {
  const fields = Object.entries(spec.action.fields || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const will = (spec.will || []).map(w => `<li>${esc(w)}</li>`).join('');
  return html(spec.title, `<h1>${esc(spec.title)}</h1><div class="card"><b>What happens next</b><ul>${will}</ul><p class="mut">${esc(spec.why)}</p></div>
<form method="${esc(spec.action.method || 'GET')}" action="${esc(spec.action.url)}">${fields}<button type="submit">${esc(spec.button || 'Authorize')}</button></form>
<p class="mut">You authorize on ${esc(spec.provider)}'s own page. Nothing to copy, paste or configure.</p>`);
}
export const doneScreen = (title, line) => html(title, `<h1>${esc(title)}</h1><div class="card">${esc(line)}</div><a class="btn" href="/">Continue</a>`);
export const failScreen = (title, line, retryUrl) => html(title, `<h1>${esc(title)}</h1><div class="card">${esc(line)}</div><a class="btn" href="${esc(retryUrl)}">Try again</a>`, 502);

// CONNECTIONS-1: the one screen where a person sees everything linked and can link or unlink with a click. Nothing here asks for a token.
export function connectionsScreen(status) {
  const when = v => v ? esc(String(v).replace('T', ' ').slice(0, 16)) : '';
  const linked = (status.linked || []).map(l => `<div class="card"><b>${esc(l.server || l.provider)}</b> <span class="mut">${esc(l.status || '')}${l.expires_at ? ' · renews before ' + when(l.expires_at) : ''}</span>${l.last_error ? `<p class="mut">Last problem: ${esc(l.last_error)}</p>` : ''}
<form method="POST" action="/connect/${esc(l.kind === 'mcp' ? 'mcp' : String(l.provider).replace(/^oauth:/, ''))}/disconnect${l.kind === 'mcp' ? '?provider=' + encodeURIComponent(l.provider) : ''}"><button type="submit">Disconnect</button></form></div>`).join('') || '<p class="mut">Nothing is linked yet.</p>';
  const avail = (status.available || []).filter(a => !a.linked && a.id !== 'mcp').map(a => a.ready
    ? `<a class="btn" href="${esc(a.connect)}">Connect ${esc(a.title)}</a>` : `<span class="mut">${esc(a.title)}: waiting for its one-time app registration</span>`).join(' ');
  return html('Connections', `<h1>Connections</h1><h2>Linked</h2>${linked}<h2>Add</h2><p>${avail || '<span class="mut">Everything available is linked.</span>'}</p>
<form method="GET" action="/connect/mcp"><p>Connect any MCP server by its address:</p><input name="server" type="url" placeholder="https://example.com/mcp" required> <button type="submit">Connect</button></form>
<p class="mut">Access is sealed in this system, renewed automatically, and removed the moment you disconnect.</p>`);
}
