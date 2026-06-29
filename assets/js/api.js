/* =====================================================================
 * api.js — Cliente da API do Mercado Livre com controle de requisições
 * ---------------------------------------------------------------------
 * - Fila sequencial com intervalo mínimo entre chamadas (rate limiting)
 * - Retry com backoff exponencial em 429 (Too Many Requests) e 5xx
 * - Respeita o header Retry-After quando presente
 * Tudo roda no navegador, sem backend.
 * ===================================================================== */

const ML = (function () {
  const BASE = "https://api.mercadolibre.com";

  // Estado configurável em runtime
  const config = {
    requestsPerSecond: 4, // limite padrão; ajustável na UI
    token: "", // access token opcional (OAuth)
    maxRetries: 4,
  };

  // ----- Rate limiter: fila que garante intervalo mínimo entre chamadas -----
  let queue = Promise.resolve();
  let lastStart = 0;

  function minInterval() {
    return 1000 / Math.max(1, config.requestsPerSecond);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Enfileira uma tarefa, respeitando o intervalo mínimo entre os inícios.
  function schedule(task) {
    const run = queue.then(async () => {
      const wait = Math.max(0, lastStart + minInterval() - Date.now());
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      return task();
    });
    // Mantém a fila viva mesmo se uma tarefa falhar.
    queue = run.then(() => {}, () => {});
    return run;
  }

  // ----- GET com retry/backoff -----
  async function get(path, params) {
    const url = new URL(BASE + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
      });
    }

    const headers = { Accept: "application/json" };
    if (config.token) headers.Authorization = "Bearer " + config.token;

    let attempt = 0;
    // Cada tentativa passa pela fila (rate limiter).
    while (true) {
      const res = await schedule(() =>
        fetch(url.toString(), { headers, mode: "cors" }).catch((e) => {
          // Erro de rede / CORS — embrulha pra tratar fora.
          throw new MLError(0, "network", e.message || "Falha de rede/CORS");
        })
      );

      if (res.ok) return res.json();

      // 429 ou 5xx -> retry com backoff; demais -> erro imediato.
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < config.maxRetries) {
        const retryAfter = parseFloat(res.headers.get("Retry-After"));
        const backoff = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s
        attempt++;
        await sleep(backoff);
        continue;
      }

      let body = "";
      try { body = JSON.stringify(await res.json()); } catch (_) {}
      throw new MLError(res.status, "http", body || res.statusText);
    }
  }

  // ----- Erro tipado -----
  class MLError extends Error {
    constructor(status, kind, detail) {
      super(`[${status}] ${detail}`);
      this.name = "MLError";
      this.status = status;
      this.kind = kind; // "network" | "http"
      this.detail = detail;
    }
  }

  // ----- Endpoints usados -----

  // Lista as categorias raiz de um site (ex.: MLB).
  function categories(site) {
    return get(`/sites/${site}/categories`);
  }

  // Detalhe de uma categoria, incluindo children_categories.
  function category(categoryId) {
    return get(`/categories/${categoryId}`);
  }

  // Uma página de busca (limit máx. 50; offset+limit <= 1000 na API pública).
  function searchPage(site, { category, q, condition, sort, offset = 0, limit = 50 }) {
    const params = { offset, limit };
    if (category) params.category = category;
    if (q) params.q = q;
    if (condition) params.condition = condition; // new | used
    if (sort) params.sort = sort; // relevance | price_asc | price_desc
    return get(`/sites/${site}/search`, params);
  }

  /* Coleta paginada até `target` itens (ou até acabar), chamando onProgress.
   * Retorna { total, results } onde total é o paging.total da API. */
  async function collect(site, query, target, onProgress) {
    const LIMIT = 50;
    const HARD_CAP = 1000; // limite de offset da busca pública
    const want = Math.min(target, HARD_CAP);
    const results = [];
    let total = null;
    let offset = 0;

    while (results.length < want) {
      const limit = Math.min(LIMIT, want - results.length);
      const page = await searchPage(site, { ...query, offset, limit });
      if (total === null) total = page.paging ? page.paging.total : 0;

      const batch = page.results || [];
      results.push(...batch);
      offset += LIMIT;

      if (onProgress) onProgress(results.length, Math.min(want, total || want));

      // Sem mais resultados disponíveis.
      if (batch.length === 0 || offset >= (total || 0) || offset >= HARD_CAP) break;
    }

    return { total: total || results.length, results };
  }

  return {
    config,
    MLError,
    categories,
    category,
    searchPage,
    collect,
    setRate(rps) { config.requestsPerSecond = rps; },
    setToken(t) { config.token = t || ""; },
  };
})();
