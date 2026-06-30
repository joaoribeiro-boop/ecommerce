/* Roda a raspagem de diagnóstico e imprime o resultado nos logs.
 * Usado pelo workflow .github/workflows/test-scrape.yml para testar se
 * é possível raspar o Mercado Livre a partir de um servidor (nuvem). */
"use strict";

const scrape = require("../scrape.js");
const query = process.env.Q || "fone bluetooth";

(async () => {
  const r = await scrape.debug({ query });
  console.log("=== SCRAPE DEBUG ===");
  console.log("query:", query);
  console.log("url:", r.url);
  console.log("finalUrl:", r.finalUrl);
  console.log("status:", r.status);
  console.log("blocked:", r.blocked);
  console.log("htmlLength:", r.htmlLength);
  console.log("parserMode:", r.parserMode);
  console.log("totalParsed:", r.totalParsed);
  console.log("totalText:", r.totalText);
  console.log("firstItems:", JSON.stringify(r.firstItems, null, 2));
  console.log("--- htmlSample (primeiros 1000 chars) ---");
  console.log((r.htmlSample || "").slice(0, 1000));
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
