// Worker-native executor: closes ZERO-MINUTES-1 step (2).
// Replaces executor.yml Actions minutes (156 min/day projected) with a tick-driven
// code agent on the Cloudflare Worker. executor.yml stays as fallback only.

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function appToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ iat: now - 60, exp: now + 600, iss: env.GITHUB_APP_ID }));
  const input = `${header}.${payload}`;
  const sig = await crypto.subtle.importKey(
    "pkcs8", str2buf(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  ).then((k) => crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, str2buf(input)));
  const jwt = `${input}.${btoaBytes(sig)}`;
  const inst = await fetch("https://api.github.com/app/installations", { headers: ghHeaders(jwt) });
  const installs = await inst.json();
  const org = installs.find((i) => i.account?.login === env.ORG);
  if (!org) throw new Error(`no installation for ${env.ORG} — NEEDS-YOU: Connect GitHub`);
  const tok = await fetch(`https://api.github.com/app/installations/${org.id}/access_tokens`, {
    method: "POST", headers: ghHeaders(jwt),
  });
  return (await tok.json()).token;
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ultrastable-worker",
  };
}

function str2buf(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function btoaBytes(buf) {
  let s = "";
  const b = new Uint8Array(buf);
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s);
}

async function getTopItem(env) {
  const row = await env.DB.prepare(
    "SELECT id, repo, title, body FROM items WHERE status = 'open' ORDER BY id LIMIT 1"
  ).first();
  return row;
}

async function aiPatch(env, item) {
  const res = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: "You make the smallest complete change that closes the item. Reply with one JSON object: {\"files\":[{\"path\":string,\"content\":string}]}. Full file contents. Never touch .github/ or autonomy/." },
      { role: "user", content: `ITEM ${item.id}: ${item.title}\n${item.body || ""}` },
    ],
    max_tokens: 4096,
  });
  return JSON.parse(res.response);
}

async function writeFiles(env, token, repo, branch, files) {
  const ref = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers: ghHeaders(token) });
  const sha = (await ref.json()).object.sha;
  const commit = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST", headers: ghHeaders(token),
    body: JSON.stringify({ message: "worker-native executor: smallest complete change", tree: [], parents: [sha] }),
  });
  void commit;
  for (const f of files) {
    const cur = await fetch(`https://api.github.com/repos/${repo}/contents/${f.path}?ref=main`, { headers: ghHeaders(token) });
    const body = { message: `worker executor: ${itemTitle}`, content: btoa(unescape(encodeURIComponent(f.content))), branch };
    if (cur.ok) body.sha = (await cur.json()).sha;
    await fetch(`https://api.github.com/repos/${repo}/contents/${f.path}`, {
      method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
    });
  }
}

let itemTitle = "";

export async function runExecutor(env) {
  const item = await getTopItem(env);
  if (!item) return { skipped: "no open items" };
  itemTitle = item.title;
  const token = await appToken(env);
  const patch = await aiPatch(env, item);
  if (!patch.files?.length) return { skipped: "agent produced no files" };
  const branch = `worker-exec/${item.id}`;
  await writeFiles(env, token, item.repo, branch, patch.files);
  const pr = await fetch(`https://api.github.com/repos/${item.repo}/pulls`, {
    method: "POST", headers: ghHeaders(token),
    body: JSON.stringify({
      title: `[worker-exec] ${item.id}: ${item.title}`,
      head: branch, base: "main",
      body: `Closes ${item.id}.\n\nProvenance: host=cloudflare-worker, model=${MODEL}. No Actions executor run.`,
    }),
  });
  const prj = await pr.json();
  await env.DB.prepare(
    "INSERT INTO executor_runs (item_id, host, pr_number, status) VALUES (?, 'cloudflare-worker', ?, ?)"
  ).bind(item.id, prj.number, pr.ok ? "ok" : "fail").run();
  if (pr.ok) await env.DB.prepare("UPDATE items SET status = 'pr-open' WHERE id = ?").bind(item.id).run();
  return { pr: prj.number, host: "cloudflare-worker" };
}
