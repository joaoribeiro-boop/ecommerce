/* =====================================================================
 * scrape.js — Raspagem das páginas públicas do Mercado Livre
 * ---------------------------------------------------------------------
 * A API de busca (/sites/MLB/search) foi bloqueada pelo ML (403 mesmo
 * com token). Aqui lemos as MESMAS páginas que qualquer pessoa vê em
 * lista.mercadolivre.com.br e extraímos os anúncios.
 *
 * Retorna itens no MESMO formato da API (title, price, shipping, seller,
 * permalink, …) para reaproveitar analysis.js/export.js sem mudanças.
 *
 * Sem dependências (usa fetch nativo do Node 18+). Best-effort: o HTML do
 * ML muda com o tempo; o endpoint /scrape/debug ajuda a reajustar.
 * ===================================================================== */

"use strict";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ").replace(/&ccedil;/g, "ç").replace(/&acirc;/g, "â")
    .replace(/&ecirc;/g, "ê").replace(/&ocirc;/g, "ô");
}

// Slug para a URL de busca por palavra-chave.
function slugify(q) {
  return String(q || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Monta a URL de busca pública. `desde` é a posição inicial (1, 49, 97, …).
function buildSearchUrl({ query, categoryId, desde }) {
  const base = "https://lista.mercadolivre.com.br";
  const slug = slugify(query);
  let url = base + "/" + slug;
  if (desde && desde > 1) url += (slug ? "_" : "/_") + "Desde_" + desde;
  else if (!slug) url += "_Desde_1";
  if (categoryId) url += "_CategID_" + categoryId;
  return url;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // No navegador (extensão) estes cabeçalhos "proibidos" são ignorados
      // e o Chrome envia os reais — o que é ótimo (parece navegação normal).
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    credentials: "include", // envia cookies da sessão do ML quando houver
  });
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

// Extrai o "preço" de um trecho (fração + centavos no padrão andes).
function extractPrices(chunk) {
  const fractions = [...chunk.matchAll(/andes-money-amount__fraction[^>]*>([\d.\s]+)</g)]
    .map((m) => parseInt(m[1].replace(/[.\s]/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const cents = [...chunk.matchAll(/andes-money-amount__cents[^>]*>(\d{1,2})</g)]
    .map((m) => parseInt(m[1], 10));
  if (!fractions.length) return { price: 0, original: 0 };
  // Geralmente: [preço_riscado_original?, preço_atual]. Pegamos o último como atual.
  const current = fractions[fractions.length - 1];
  const original = fractions.length > 1 ? fractions[0] : current;
  const c = cents.length ? cents[cents.length - 1] / 100 : 0;
  return { price: current + c, original };
}

// Faz o parsing de uma página de resultados -> itens (formato API).
function parseItems(html) {
  const items = [];
  // Cada card moderno começa com class="...poly-card...". Dividimos por isso.
  let chunks = html.split(/class="[^"]*poly-card/);
  let mode = "poly";
  if (chunks.length < 2) {
    // Layout antigo: ui-search-layout__item
    chunks = html.split(/class="[^"]*ui-search-layout__item/);
    mode = "ui-search";
  }

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Título + link.
    let title = "", url = "";
    let m =
      chunk.match(/poly-component__title[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      chunk.match(/<a[^>]*href="([^"]+)"[^>]*poly-component__title[^>]*>([\s\S]*?)<\/a>/) ||
      chunk.match(/ui-search-item__title[^>]*>([\s\S]*?)<\/[^>]+>/);
    if (m) {
      if (m.length >= 3) { url = m[1]; title = stripTags(m[2]); }
      else { title = stripTags(m[1]); }
    }
    if (!url) {
      const hm = chunk.match(/href="(https:\/\/(?:produto\.|www\.|click1\.|[^"]*?)mercadolivre[^"]+)"/);
      if (hm) url = hm[1];
    }
    if (!title) continue; // sem título, não é um card válido

    const { price, original } = extractPrices(chunk);
    const freeShipping = /Frete\s*gr[áa]tis/i.test(chunk);
    let seller = "";
    const sm = chunk.match(/poly-component__seller[^>]*>([\s\S]*?)<\/[^>]+>/);
    if (sm) seller = stripTags(sm[1]).replace(/^por\s+/i, "");

    // ID do anúncio a partir do link (MLB-123... ou /p/MLBxxxx).
    let id = "";
    const idm = (url || "").match(/(MLB-?\d{6,})/);
    if (idm) id = idm[1].replace("-", "");

    items.push({
      id,
      title,
      price,
      original_price: original,
      currency_id: "BRL",
      condition: "",
      sold_quantity: 0,
      available_quantity: 0,
      shipping: { free_shipping: freeShipping },
      listing_type_id: "",
      seller: { id: "", nickname: seller },
      address: {},
      catalog_listing: /\/p\/MLB/i.test(url || ""),
      permalink: url,
    });
  }

  return { items, mode };
}

// Tenta achar o total de resultados ("1.234 resultados").
function parseTotal(html) {
  const m = html.match(/([\d.]+)\s+resultados/i);
  return m ? parseInt(m[1].replace(/\./g, ""), 10) : null;
}

// Detecta página de bloqueio/anti-bot.
function looksBlocked(status, html, finalUrl) {
  if (status === 403 || status === 429) return true;
  if (/captcha|To continue, please verify|Access Denied|unusual traffic/i.test(html)) return true;
  // Página de "tráfego suspeito"/verificação de conta (anti-bot do ML).
  if (/suspicious-traffic|account-verification|gz\/account-verification/i.test(html)) return true;
  if (finalUrl && /account-verification|suspicious/i.test(finalUrl)) return true;
  return false;
}

/* Coleta paginada até `target` itens. onProgress(coletados, alvo). */
async function scrapeSearch({ query, categoryId, target = 200 }, onProgress, opts = {}) {
  const delayMs = opts.delayMs != null ? opts.delayMs : 1500;
  const results = [];
  let total = null;
  let desde = 1;
  let pages = 0;
  const maxPages = Math.ceil(target / 40) + 2;

  while (results.length < target && pages < maxPages) {
    const url = buildSearchUrl({ query, categoryId, desde });
    const { status, html, finalUrl } = await fetchHtml(url);

    if (looksBlocked(status, html, finalUrl)) {
      const err = new Error(`Bloqueado pelo ML (status ${status}).`);
      err.status = status; err.blocked = true; err.url = finalUrl || url;
      throw err;
    }

    const { items } = parseItems(html);
    if (total === null) total = parseTotal(html);
    if (!items.length) break; // acabou ou parser não casou

    results.push(...items);
    if (onProgress) onProgress(results.length, Math.min(target, total || target));

    pages++;
    desde += items.length; // próxima página começa após os itens desta
    if (results.length < target) await sleep(delayMs);
  }

  return { total: total || results.length, results: results.slice(0, target) };
}

// Diagnóstico: ajuda a reajustar o parser ao HTML real.
async function debug({ query, categoryId }) {
  const url = buildSearchUrl({ query, categoryId, desde: 1 });
  const { status, html, finalUrl } = await fetchHtml(url);
  const { items, mode } = parseItems(html);
  return {
    url, finalUrl, status,
    blocked: looksBlocked(status, html, finalUrl),
    htmlLength: html.length,
    parserMode: mode,
    totalParsed: items.length,
    totalText: parseTotal(html),
    firstItems: items.slice(0, 3),
    htmlSample: html.slice(0, 1500),
  };
}

// Dual-mode: Node (server/Action) e navegador (extensão Chrome).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { scrapeSearch, debug, buildSearchUrl, parseItems };
} else if (typeof window !== "undefined") {
  window.MLScrape = { scrapeSearch, debug, buildSearchUrl, parseItems };
}
