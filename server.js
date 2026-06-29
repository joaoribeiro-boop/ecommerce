/* =====================================================================
 * server.js — Backend mínimo (zero dependências) para o app de análise
 * ---------------------------------------------------------------------
 * O que ele faz:
 *   - Serve os arquivos estáticos (index.html, assets/…)
 *   - Faz o fluxo OAuth do Mercado Livre (login + callback)
 *   - Guarda os tokens em tokens.json e RENOVA o access_token sozinho
 *   - Faz proxy de /api/* -> https://api.mercadolibre.com/* já com o token
 *
 * Roda com:  node server.js
 * Requer Node 18+ (usa fetch nativo). Sem npm install.
 * ===================================================================== */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- .env (parser simples, sem dependência) ----------
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

const PORT = parseInt(process.env.PORT || "3000", 10);
const CLIENT_ID = process.env.ML_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.ML_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const AUTH_DOMAIN = process.env.ML_AUTH_DOMAIN || "auth.mercadolivre.com.br";
const API_BASE = "https://api.mercadolibre.com";
const TOKENS_FILE = path.join(__dirname, "tokens.json");

// ---------- Armazenamento de tokens ----------
function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); }
  catch (_) { return null; }
}
function writeTokens(t) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

// Troca authorization_code OU refresh_token por novos tokens.
async function requestToken(params) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...params,
  });
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
  // Carimba o momento de obtenção para calcular expiração.
  data.obtained_at = Date.now();
  writeTokens(data);
  return data;
}

// Retorna um access_token válido (renovando se preciso) ou null se não logado.
async function getValidToken() {
  let t = readTokens();
  if (!t || !t.access_token) return null;
  const expiresAt = (t.obtained_at || 0) + (t.expires_in || 0) * 1000;
  // Renova se faltam menos de 60s.
  if (Date.now() > expiresAt - 60_000) {
    if (!t.refresh_token) return null;
    try {
      t = await requestToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    } catch (e) {
      console.error("Falha ao renovar token:", e.message);
      return null;
    }
  }
  return t.access_token;
}

// ---------- Helpers HTTP ----------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // Bloqueia path traversal.
  const filePath = path.normalize(path.join(__dirname, rel));
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end("Forbidden"); }
  // Não serve arquivos sensíveis.
  const base = path.basename(filePath);
  if (base === ".env" || base === "tokens.json" || base === "server.js") {
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
  if (token) headers.Authorization = "Bearer " + token; // endpoints públicos funcionam mesmo sem

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

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Status para o frontend detectar o backend e o login.
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

  // Inicia o login OAuth.
  if (p === "/auth/login") {
    if (!CLIENT_ID) { res.writeHead(500); return res.end("ML_CLIENT_ID não configurado no .env"); }
    const authUrl = `https://${AUTH_DOMAIN}/authorization?` + new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    });
    return redirect(res, authUrl);
  }

  // Callback do OAuth: troca o code por tokens.
  if (p === "/auth/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) { res.writeHead(400); return res.end("Erro no login: " + error); }
    if (!code) { res.writeHead(400); return res.end("Faltou o parâmetro 'code'."); }
    try {
      await requestToken({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
      return redirect(res, "/?logged_in=1");
    } catch (e) {
      res.writeHead(500);
      return res.end("Falha ao obter token: " + e.message);
    }
  }

  // Logout: apaga os tokens.
  if (p === "/auth/logout") {
    try { fs.unlinkSync(TOKENS_FILE); } catch (_) {}
    return redirect(res, "/");
  }

  // Proxy da API.
  if (p.startsWith("/api/")) {
    if (req.method !== "GET") { res.writeHead(405); return res.end("Method not allowed"); }
    return handleApi(req, res, url);
  }

  // Arquivos estáticos.
  return serveStatic(req, res, p);
});

server.listen(PORT, () => {
  console.log(`\n  Análise de Mercado rodando em  http://localhost:${PORT}\n`);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log("  ⚠️  Faltam credenciais. Crie um arquivo .env (veja .env.example):");
    console.log("      ML_CLIENT_ID e ML_CLIENT_SECRET\n");
  } else {
    console.log("  1) Abra o navegador no endereço acima");
    console.log("  2) Clique em 'Conectar ao Mercado Livre' para autorizar");
    console.log("  3) O token é renovado automaticamente.\n");
  }
});
