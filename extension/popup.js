/* =====================================================================
 * popup.js — Lê a página de busca aberta do Mercado Livre
 * ---------------------------------------------------------------------
 * Em vez de buscar "por fora" (o que cai no anti-bot), injeta um script
 * na aba do ML que já está aberta e LÊ o HTML real (já liberado), além
 * de paginar via fetch same-origin (com a sessão da página). Depois roda
 * a análise (Analysis) e gera a planilha (Exporter) aqui no popup.
 * ===================================================================== */

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let lastAnalysis = null;

  function status(msg) { $("status").textContent = msg; }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  function isML(url) { return /mercadolivre\.com\.br/i.test(url || ""); }

  // ---- Funções injetadas na aba do ML (precisam ser autossuficientes) ----

  // Lê a 1ª página do DOM e pagina via fetch same-origin até `target`.
  function scrapeInPage(target) {
    return (async () => {
      function nextUrl(desde) {
        const u = new URL(location.href);
        let path = u.pathname.replace(/_Desde_\d+/g, "").replace(/\/$/, "");
        u.pathname = path + "_Desde_" + desde;
        return u.toString();
      }
      const out = [];
      let parsed = MLScrape.parseItems(document.documentElement.outerHTML).items;
      out.push(...parsed);
      let desde = (parsed.length || 48) + 1;
      let guard = 0;
      while (out.length < target && parsed.length > 0 && guard < 25) {
        guard++;
        let html;
        try {
          const res = await fetch(nextUrl(desde), { credentials: "include" });
          html = await res.text();
        } catch (e) { break; }
        if (/suspicious-traffic|account-verification/i.test(html)) break;
        parsed = MLScrape.parseItems(html).items;
        if (!parsed.length) break;
        out.push(...parsed);
        desde += parsed.length;
        await new Promise((r) => setTimeout(r, 1200));
      }
      return { items: out.slice(0, target), total: out.length };
    })();
  }

  // Diagnóstico: estrutura real da página (para ajustar o parser se preciso).
  function diagInPage() {
    const html = document.documentElement.outerHTML;
    const keys = ["poly-card", "poly-component__title", "poly-price",
      "ui-search-layout__item", "ui-search-result", "andes-money-amount__fraction",
      "ui-search-item__title"];
    const markers = {};
    keys.forEach((k) => { markers[k] = html.split(k).length - 1; });
    let firstCard = "";
    const el = document.querySelector(".poly-card, .ui-search-layout__item, [class*='poly-card'], li[class*='ui-search']");
    if (el) firstCard = el.outerHTML.slice(0, 1500);
    let parsedCount = 0, first = null;
    try {
      const p = MLScrape.parseItems(html).items;
      parsedCount = p.length; first = p[0] || null;
    } catch (e) {}
    return {
      url: location.href, title: document.title, htmlLength: html.length,
      markers, parsedCount, firstCard, first,
    };
  }

  // ---- Orquestração no popup ----

  async function inject(tabId, func, args) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["scrape.js"] });
    const res = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
    return res && res[0] ? res[0].result : null;
  }

  async function run() {
    $("btn-export").classList.add("hidden");
    const tab = await activeTab();
    if (!isML(tab.url)) {
      status("⚠️ Abra uma busca em mercadolivre.com.br nesta aba e tente de novo.");
      return;
    }
    const target = parseInt($("qty").value, 10);
    $("btn-run").disabled = true;
    status("Lendo a página de busca…");
    try {
      const result = await inject(tab.id, scrapeInPage, [target]);
      const items = result && result.items ? result.items : [];
      if (!items.length) {
        status("Não reconheci anúncios nesta página. Clique em 🔧 Diagnóstico e me envie o conteúdo.");
        return;
      }
      const meta = {
        site: "MLB · Brasil", categoryId: "", categoryName: "",
        query: (tab.title || "").replace(/\s*\|.*/, ""), total: result.total,
        date: new Date().toLocaleString("pt-BR"),
      };
      lastAnalysis = Analysis.run(meta, items);
      status(`✅ ${items.length} anúncios coletados. Baixe a planilha abaixo.`);
      $("btn-export").classList.remove("hidden");
    } catch (e) {
      status("Erro: " + (e.message || String(e)));
    } finally {
      $("btn-run").disabled = false;
    }
  }

  async function diag() {
    const out = $("debug-out");
    const tab = await activeTab();
    if (!isML(tab.url)) {
      out.classList.remove("hidden");
      out.value = "Abra uma busca em mercadolivre.com.br nesta aba primeiro.";
      return;
    }
    out.classList.remove("hidden");
    out.value = "Rodando diagnóstico…";
    try {
      const r = await inject(tab.id, diagInPage, []);
      out.value = JSON.stringify(r, null, 2);
      out.focus(); out.select();
    } catch (e) {
      out.value = "ERRO: " + (e.message || String(e));
    }
  }

  function exportXlsx() {
    if (!lastAnalysis) return;
    const s = lastAnalysis.summary;
    const slug = (s.PalavraChave || "mercado").toString().replace(/[^\w-]+/g, "_").slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    Exporter.download(lastAnalysis, `analise_${slug}_${stamp}.xlsx`);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("btn-run").addEventListener("click", run);
    $("btn-debug").addEventListener("click", diag);
    $("btn-export").addEventListener("click", exportXlsx);
  });
})();
