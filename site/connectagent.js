// CONNECT-PAGE-1: one click to connect any agent harness to Ultrastable's MCP endpoint. No token is typed or pasted:
// the client discovers OAuth from /mcp and the browser handles consent. Deep links per client; CLIs get a copy button.
const URL_MCP = "https://ultrastable.io/mcp", NAME = "ultrastable";
const b64 = s => btoa(unescape(encodeURIComponent(s)));
export function connectLinks() {
  const cfg = JSON.stringify({ type: "http", url: URL_MCP });
  return {
    vscode: "vscode:mcp/install?" + encodeURIComponent(JSON.stringify({ name: NAME, type: "http", url: URL_MCP })),
    vscode_insiders: "vscode-insiders:mcp/install?" + encodeURIComponent(JSON.stringify({ name: NAME, type: "http", url: URL_MCP })),
    cursor: "cursor://anysphere.cursor-deeplink/mcp/install?name=" + NAME + "&config=" + encodeURIComponent(b64(JSON.stringify({ url: URL_MCP }))),
    claude_code: "claude mcp add --transport http " + NAME + " " + URL_MCP,
    codex: "codex mcp add " + NAME + " --url " + URL_MCP,
    mcp_json: JSON.stringify({ mcpServers: { [NAME]: { type: "http", url: URL_MCP } } }, null, 2),
    claude_connector_url: URL_MCP, config: cfg,
  };
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export function connectAgentPage() {
  const l = connectLinks();
  const copy = (label, text) => `<button onclick="navigator.clipboard.writeText(this.dataset.t);this.textContent='Copied'" data-t="${esc(text)}">${label}</button>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your agent to Ultrastable</title>
<style>body{font:16px system-ui;max-width:640px;margin:3rem auto;padding:0 1rem}a.b,button{display:block;width:100%;margin:.5rem 0;padding:.9rem;font:inherit;border:1px solid #888;border-radius:8px;background:#fff;text-align:center;text-decoration:none;color:#111;cursor:pointer}small{color:#555}</style>
<h1>Connect your agent</h1><p>Click your tool. It opens, asks you to sign in once in your browser, and you are connected. Nothing to copy or paste.</p>
<a class="b" href="${esc(l.vscode)}">Add to VS Code (Copilot, Claude, Codex)</a>
<a class="b" href="${esc(l.vscode_insiders)}">Add to VS Code Insiders</a>
<a class="b" href="${esc(l.cursor)}">Add to Cursor</a>
${copy("Claude Code: copy the one command", l.claude_code)}
${copy("Codex: copy the one command", l.codex)}
${copy("Claude (web, desktop, mobile): copy the connector address", l.claude_connector_url)}
${copy("Any other MCP client: copy .mcp.json", l.mcp_json)}
<p><small>Standards: MCP over HTTP with OAuth 2.1 discovery. Also reachable as <a href="/.well-known/agent-card.json">an A2A agent</a> and <a href="/openapi.json">an OpenAPI service</a>.</small></p>`;
}
