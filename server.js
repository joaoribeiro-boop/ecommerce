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
const scrape = require("./scrape.js");

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

// ---------- Insights: busca por título com preço e nº de vendas ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function mlGet(pathname, token) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API_BASE + pathname, { headers });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Busca oficial paginada (/sites/{site}/search). Funciona quando a sua
// aplicação tem acesso ao endpoint; já traz sold_quantity por anúncio.
async function apiSearch({ site = "MLB", query, categoryId, condition, sort, target = 200 }, token) {
  const want = Math.min(target, 1000); // teto da busca pública (offset+limit)
  const results = [];
  let total = null;
  let offset = 0;
  while (results.length < want) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(Math.min(50, want - results.length)),
    });
    if (query) params.set("q", query);
    if (categoryId) params.set("category", categoryId);
    if (condition) params.set("condition", condition);
    if (sort && sort !== "relevance") params.set("sort", sort);
    const { ok, status, data } = await mlGet(`/sites/${site}/search?` + params, token);
    if (!ok) {
      const err = new Error(`Busca oficial: HTTP ${status}`);
      err.status = status;
      throw err;
    }
    if (total === null) total = (data && data.paging && data.paging.total) || 0;
    const batch = (data && data.results) || [];
    if (!batch.length) break;
    results.push(...batch);
    offset += batch.length;
    if (offset >= Math.min(total, 1000)) break;
    await sleep(250);
  }
  return { total: total || results.length, results };
}

// Enriquecimento: multiget /items?ids=… (20 por chamada) para obter
// sold_quantity, condition, preço oficial etc. dos anúncios raspados.
const ITEM_ATTRS = [
  "id", "title", "price", "original_price", "currency_id", "condition",
  "sold_quantity", "available_quantity", "permalink", "listing_type_id",
  "shipping", "seller_id", "official_store_id", "catalog_listing", "date_created",
].join(",");

async function enrichWithApi(items, token) {
  const ids = [...new Set(items.map((it) => it.id).filter(Boolean))];
  const byId = new Map();
  let failures = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const { ok, status, data } = await mlGet(`/items?ids=${batch.join(",")}&attributes=${ITEM_ATTRS}`, token);
    if (!ok) {
      failures++;
      if (status === 401 || status === 403 || failures >= 3) break; // sem permissão / instável: desiste
      await sleep(1000);
      continue;
    }
    for (const r of data || []) {
      if (r && r.code === 200 && r.body && r.body.id) byId.set(r.body.id, r.body);
    }
    if (i + 20 < ids.length) await sleep(300);
  }

  let enrichedCount = 0;
  const merged = items.map((it) => {
    const api = byId.get(it.id);
    if (!api) return it;
    enrichedCount++;
    return {
      ...it,
      title: api.title || it.title,
      price: api.price != null ? api.price : it.price,
      original_price: api.original_price != null ? api.original_price : it.original_price,
      currency_id: api.currency_id || it.currency_id,
      condition: api.condition || it.condition,
      sold_quantity: api.sold_quantity != null ? api.sold_quantity : it.sold_quantity,
      available_quantity: api.available_quantity != null ? api.available_quantity : it.available_quantity,
      listing_type_id: api.listing_type_id || it.listing_type_id,
      shipping: api.shipping || it.shipping,
      catalog_listing: api.catalog_listing != null ? api.catalog_listing : it.catalog_listing,
      permalink: api.permalink || it.permalink,
      seller: {
        id: api.seller_id || (it.seller && it.seller.id) || "",
        nickname: (it.seller && it.seller.nickname) || "",
      },
      date_created: api.date_created || "",
    };
  });
  return { merged, enrichedCount, idCount: ids.length };
}

async function handleInsightsSearch(res, url) {
  const query = url.searchParams.get("q") || "";
  const categoryId = url.searchParams.get("category") || "";
  const condition = url.searchParams.get("condition") || "";
  const sort = url.searchParams.get("sort") || "";
  const site = url.searchParams.get("site") || "MLB";
  const target = Math.min(parseInt(url.searchParams.get("target") || "200", 10) || 200, 1000);
  if (!query && !categoryId) return sendJSON(res, 400, { error: "missing_query" });

  const token = await getValidToken();
  const warnings = [];

  // 1) Busca oficial da API — melhor fonte (traz sold_quantity direto).
  if (token) {
    try {
      const out = await apiSearch({ site, query, categoryId, condition, sort, target }, token);
      return sendJSON(res, 200, { source: "api", enriched: true, warnings, ...out });
    } catch (e) {
      warnings.push(`Busca oficial indisponível para esta aplicação (HTTP ${e.status || "?"}). Usando raspagem + API de itens.`);
    }
  } else {
    warnings.push("Sem conexão com o Mercado Livre: nº de vendas indisponível. Clique em “Conectar ao Mercado Livre”.");
  }

  // 2) Raspagem das páginas públicas para descobrir os anúncios do título…
  let out;
  try {
    out = await scrape.scrapeSearch({ query, categoryId, target });
  } catch (e) {
    return sendJSON(res, e.blocked ? 403 : 502, {
      error: e.blocked ? "blocked" : "scrape_error",
      message: e.message, url: e.url, warnings,
    });
  }

  // Remove duplicatas entre páginas (anúncios patrocinados se repetem).
  const seenIds = new Set();
  out.results = out.results.filter((it) => {
    if (!it.id) return true;
    if (seenIds.has(it.id)) return false;
    seenIds.add(it.id);
    return true;
  });

  // 3) …e enriquecimento via API de itens (preço oficial, nº de vendas).
  let enriched = false;
  if (token && out.results.length) {
    const { merged, enrichedCount, idCount } = await enrichWithApi(out.results, token);
    out.results = merged;
    enriched = enrichedCount > 0;
    if (!enriched) {
      warnings.push("A API de itens não retornou dados (verifique as permissões da aplicação em /insights/debug).");
    } else if (enrichedCount < idCount) {
      warnings.push(`Dados oficiais obtidos para ${enrichedCount} de ${idCount} anúncios.`);
    }
  }

  let results = out.results;
  if (condition) results = results.filter((it) => !it.condition || it.condition === condition);

  return sendJSON(res, 200, {
    source: token ? "scrape+api" : "scrape",
    enriched, warnings,
    total: out.total,
    results,
  });
}

// Diagnóstico: mostra o que a SUA aplicação consegue acessar na API.
async function handleInsightsDebug(res, url) {
  const query = url.searchParams.get("q") || "fone bluetooth";
  const site = url.searchParams.get("site") || "MLB";
  const token = await getValidToken();
  const report = { authenticated: Boolean(token), query, site, checks: {} };
  if (!token) {
    report.hint = "Conecte primeiro em /auth/login para testar os endpoints autenticados.";
    return sendJSON(res, 200, report);
  }

  const enc = encodeURIComponent(query);
  const s = await mlGet(`/sites/${site}/search?q=${enc}&limit=2`, token);
  report.checks.busca_oficial = {
    endpoint: `/sites/${site}/search`, status: s.status,
    total: s.ok && s.data.paging ? s.data.paging.total : null,
    amostra: s.ok ? (s.data.results || []).slice(0, 1) : s.data,
  };

  const pr = await mlGet(`/products/search?site_id=${site}&status=active&q=${enc}&limit=2`, token);
  report.checks.busca_catalogo = {
    endpoint: "/products/search", status: pr.status,
    amostra: pr.ok ? (pr.data.results || []).slice(0, 1) : pr.data,
  };

  // Pega um anúncio real (raspando 1 página) e testa o multiget de itens.
  try {
    const scraped = await scrape.scrapeSearch({ query, target: 3 });
    const id = (scraped.results.find((r) => r.id) || {}).id;
    if (id) {
      const it = await mlGet(`/items?ids=${id}&attributes=id,title,price,sold_quantity,condition`, token);
      report.checks.api_de_itens = { endpoint: "/items?ids=…", itemTestado: id, status: it.status, resposta: it.data };
    } else {
      report.checks.api_de_itens = { erro: "raspagem não retornou IDs para testar" };
    }
  } catch (e) {
    report.checks.api_de_itens = { erro: "raspagem bloqueada: " + e.message };
  }

  return sendJSON(res, 200, report);
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
    if (p.startsWith("/api/") || p.startsWith("/auth/") || p.startsWith("/insights/") || p.startsWith("/scrape/")) {
      return sendJSON(res, 401, { error: "locked" });
    }
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

  // Insights por título: API oficial (com seu token) + fallback raspagem
  // enriquecida pela API de itens (preço, nº de vendas).
  if (p === "/insights/search") return handleInsightsSearch(res, url);
  if (p === "/insights/debug") return handleInsightsDebug(res, url);

  // Raspagem do site público (sem token) — substitui a busca da API.
  if (p === "/scrape/search") {
    const query = url.searchParams.get("q") || "";
    const categoryId = url.searchParams.get("category") || "";
    const target = Math.min(parseInt(url.searchParams.get("target") || "200", 10) || 200, 1000);
    if (!query && !categoryId) return sendJSON(res, 400, { error: "missing_query" });
    try {
      const out = await scrape.scrapeSearch({ query, categoryId, target });
      return sendJSON(res, 200, out);
    } catch (e) {
      return sendJSON(res, e.blocked ? 403 : 502, {
        error: e.blocked ? "blocked" : "scrape_error",
        message: e.message, url: e.url,
      });
    }
  }

  // Diagnóstico da raspagem (abra no navegador e me mande o resultado).
  if (p === "/scrape/debug") {
    const query = url.searchParams.get("q") || "";
    const categoryId = url.searchParams.get("category") || "";
    try {
      return sendJSON(res, 200, await scrape.debug({ query, categoryId }));
    } catch (e) {
      return sendJSON(res, 502, { error: "scrape_error", message: e.message });
    }
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
