/* =====================================================================
 * server.js — Backend do app de análise (zero dependências)
 * ---------------------------------------------------------------------
 *   - Serve os arquivos estáticos (index.html, assets/…)
 *   - Fluxo OAuth (PKCE) do Mercado Livre (login + callback)
 *   - Guarda tokens em DATA_DIR/tokens.json e renova sozinho (com mutex)
 *   - Proxy de /api/* -> https://api.mercadolibre.com/* já com o token
 *   - Trava opcional por senha (APP_PASSWORD)
 *
 * Pode rodar de duas formas:
 *   - CLI:        node server.js          (dev; lê .env)
 *   - Importado:  require("./server.js").startServer({ port })   (Electron)
 *
 * Caminhos configuráveis por ambiente (usados pelo empacotamento Electron):
 *   STATIC_DIR  -> onde estão index.html/assets (padrão: pasta do server.js)
 *   DATA_DIR    -> onde gravar tokens.json (padrão: pasta do server.js)
 *
 * Credenciais (ordem: variável de ambiente/.env > arquivo embutido):
 *   ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI, ML_AUTH_DOMAIN, APP_PASSWORD
 *   Arquivo embutido opcional: ./app-credentials.js  (gitignored)
 * ===================================================================== */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- .env (parser simples) ----------
function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// Credenciais embutidas (opcional) — usadas no app empacotado.
let baked = {};
try { baked = require("./app-credentials.js") || {}; } catch (_) { /* sem arquivo: ok */ }
const cred = (k) => process.env[k] || baked[k] || "";

const STATIC_DIR = process.env.STATIC_DIR || __dirname;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const CLIENT_ID = cred("ML_CLIENT_ID");
const CLIENT_SECRET = cred("ML_CLIENT_SECRET");
const AUTH_DOMAIN = cred("ML_AUTH_DOMAIN") || "auth.mercadolivre.com.br";
const APP_PASSWORD = cred("APP_PASSWORD");
const API_BASE = "https://api.mercadolibre.com";
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");

// Definidos no startServer (dependem da porta real).
let PORT = parseInt(process.env.PORT || "3000", 10);
let REDIRECT_URI = cred("ML_REDIRECT_URI") || `http://localhost:${PORT}/auth/callback`;

// ---------- Armazenamento de tokens ----------
function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); }
  catch (_) { return null; }
}
function writeTokens(t) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

// ---------- PKCE ----------
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
let pendingVerifier = null;
function newPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------- Tokens OAuth ----------
async function requestToken(params) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params });
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`OAuth ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  data.obtained_at = Date.now();
  writeTokens(data);
  return data;
}

// Renova com mutex: chamadas simultâneas compartilham a mesma renovação.
let refreshing = null;
async function getValidToken() {
  let t = readTokens();
  if (!t || !t.access_token) return null;
  const expiresAt = (t.obtained_at || 0) + (t.expires_in || 0) * 1000;
  if (Date.now() > expiresAt - 60_000) {
    if (!t.refresh_token) return null;
    try {
      if (!refreshing) {
        refreshing = requestToken({ grant_type: "refresh_token", refresh_token: t.refresh_token })
          .finally(() => { refreshing = null; });
      }
      t = await refreshing;
    } catch (e) {
      console.error("Falha ao renovar token:", e.message);
      return null;
    }
  }
  return t.access_token;
}

// ---------- Helpers HTTP ----------
function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(data));
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

// ---------- Trava por senha ----------
const SESSION_VALUE = APP_PASSWORD
  ? crypto.createHash("sha256").update("ml-analise|" + APP_PASSWORD).digest("hex")
  : "";
function isUnlocked(req) {
  if (!APP_PASSWORD) return true; // sem senha configurada
  return parseCookies(req).sess === SESSION_VALUE;
}
function unlockPage(error) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acesso</title><style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fb;display:grid;place-items:center;height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 3px rgba(16,24,40,.1);width:300px}
h1{font-size:18px;margin:0 0 16px}input{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box}
button{width:100%;margin-top:12px;padding:10px;background:#2563eb;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer}
.err{color:#dc2626;font-size:13px;margin-top:10px}</style></head>
<body><form method="POST" action="/unlock"><h1>🔒 Acesso restrito</h1>
<input type="password" name="password" placeholder="Senha" autofocus>
<button type="submit">Entrar</button>
${error ? '<div class="err">Senha incorreta.</div>' : ""}</form></body></html>`;
}

// ---------- Estáticos ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  const base = path.basename(filePath);
  if (base === ".env" || base === "tokens.json" || base === "server.js" || base === "app-credentials.js") {
    res.writeHead(404); return res.end("Not found");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- Proxy /api/* ----------
async function handleApi(req, res, url) {
  const target = API_BASE + url.pathname.replace(/^\/api/, "") + (url.search || "");
  const headers = { Accept: "application/json" };
  const token = await getValidToken();
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const upstream = await fetch(target, { headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
    res.end(text);
  } catch (e) {
    sendJSON(res, 502, { error: "proxy_error", message: e.message });
  }
}

// ---------- Handler principal ----------
async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Trava por senha (libera só a própria tela de senha).
  if (p === "/unlock") {
    if (req.method === "POST") {
      const body = await readBody(req);
      const password = new URLSearchParams(body).get("password") || "";
      if (APP_PASSWORD && password === APP_PASSWORD) {
        res.writeHead(302, {
          "Set-Cookie": `sess=${SESSION_VALUE}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
          Location: "/",
        });
        return res.end();
      }
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(unlockPage(true));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(unlockPage(false));
  }
  if (!isUnlocked(req)) {
    if (p.startsWith("/api/") || p.startsWith("/auth/")) return sendJSON(res, 401, { error: "locked" });
    return redirect(res, "/unlock");
  }

  // Status para o frontend.
  if (p === "/auth/status") {
    const t = readTokens();
    const expiresAt = t ? (t.obtained_at || 0) + (t.expires_in || 0) * 1000 : null;
    return sendJSON(res, 200, {
      backend: true,
      hasCredentials: Boolean(CLIENT_ID && CLIENT_SECRET),
      authenticated: Boolean(t && t.access_token),
      expiresAt,
    });
  }

  // Login OAuth.
  if (p === "/auth/login") {
    if (!CLIENT_ID) { res.writeHead(500); return res.end("ML_CLIENT_ID não configurado"); }
    const pkce = newPkce();
    pendingVerifier = pkce.verifier;
    const authUrl = `https://${AUTH_DOMAIN}/authorization?` + new URLSearchParams({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      code_challenge: pkce.challenge, code_challenge_method: "S256",
    });
    return redirect(res, authUrl);
  }

  // Callback OAuth.
  if (p === "/auth/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) { res.writeHead(400); return res.end("Erro no login: " + error); }
    if (!code) { res.writeHead(400); return res.end("Faltou o parâmetro 'code'."); }
    try {
      const params = { grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI };
      if (pendingVerifier) params.code_verifier = pendingVerifier;
      await requestToken(params);
      pendingVerifier = null;
      return redirect(res, "/?logged_in=1");
    } catch (e) {
      res.writeHead(500);
      return res.end("Falha ao obter token: " + e.message);
    }
  }

  // Logout.
  if (p === "/auth/logout") {
    try { fs.unlinkSync(TOKENS_FILE); } catch (_) {}
    return redirect(res, "/");
  }

  // Proxy.
  if (p.startsWith("/api/")) {
    if (req.method !== "GET") { res.writeHead(405); return res.end("Method not allowed"); }
    return handleApi(req, res, url);
  }

  // Estáticos.
  return serveStatic(req, res, p);
}

// ---------- Inicialização ----------
function startServer(opts = {}) {
  if (opts.port) PORT = opts.port;
  REDIRECT_URI = cred("ML_REDIRECT_URI") || `http://localhost:${PORT}/auth/callback`;
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error("Erro no handler:", e);
      try { sendJSON(res, 500, { error: "server_error", message: e.message }); } catch (_) {}
    });
  });
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      const addr = `http://localhost:${PORT}`;
      if (!opts.quiet) {
        console.log(`\n  Análise de Mercado rodando em  ${addr}\n`);
        if (!CLIENT_ID || !CLIENT_SECRET) {
          console.log("  ⚠️  Faltam credenciais (ML_CLIENT_ID / ML_CLIENT_SECRET).\n");
        }
      }
      resolve({ server, port: PORT, url: addr });
    });
  });
}

module.exports = { startServer };

// Execução direta (CLI).
if (require.main === module) startServer();
