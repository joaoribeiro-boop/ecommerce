/* =====================================================================
 * app-ext.js — Lógica da extensão Chrome
 * ---------------------------------------------------------------------
 * - Categorias: lidas direto da API pública (sem token)
 * - Anúncios: raspagem das páginas do ML pelo próprio navegador
 * - Análise e planilha: reaproveita Analysis (analysis.js) e Exporter (export.js)
 * ===================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SITE = "MLB"; // Brasil (lista.mercadolivre.com.br)
  const API = "https://api.mercadolibre.com";

  const state = { path: [], selected: null, lastAnalysis: null };

  async function apiJSON(path) {
    const res = await fetch(API + path, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("API " + res.status + " em " + path);
    return res.json();
  }

  /* ---------- Categorias ---------- */
  async function initCategories() {
    state.path = []; state.selected = null;
    $("category-loading").classList.remove("hidden");
    $("category-loading").textContent = "Carregando categorias…";
    $("category-path").innerHTML = "";
    try {
      const cats = await apiJSON(`/sites/${SITE}/categories`);
      renderCategorySelect(cats, true);
      $("category-loading").classList.add("hidden");
    } catch (e) {
      $("category-loading").textContent =
        "Não consegui carregar as categorias. Você ainda pode analisar por palavra-chave.";
    }
  }

  function renderBreadcrumb() {
    const wrap = $("category-path");
    wrap.innerHTML = "";
    state.path.forEach((c) => {
      const chip = document.createElement("span");
      chip.className = "cat-chip";
      chip.textContent = c.name;
      wrap.appendChild(chip);
    });
  }

  function renderCategorySelect(children, isRoot) {
    renderBreadcrumb();
    const old = document.querySelector(".cat-select");
    if (old) old.remove();
    if (!children || !children.length) return;

    const sel = document.createElement("select");
    sel.className = "cat-select";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = isRoot ? "Selecione uma categoria…" : "Selecione uma subcategoria… (ou analise a atual)";
    sel.appendChild(ph);
    children.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name + (c.total_items_in_this_category != null
        ? ` (${c.total_items_in_this_category.toLocaleString("pt-BR")})` : "");
      o.dataset.name = c.name;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => onSelectCategory(sel));
    $("category-path").after(sel);
  }

  async function onSelectCategory(sel) {
    const id = sel.value;
    if (!id) return;
    const name = sel.selectedOptions[0].dataset.name;
    state.path.push({ id, name });
    state.selected = { id, name };
    try {
      const detail = await apiJSON(`/categories/${id}`);
      renderCategorySelect(detail.children_categories || [], false);
    } catch (e) {
      renderCategorySelect([], false);
    }
  }

  /* ---------- Execução ---------- */
  function setProgress(done, total) {
    const pct = total ? Math.min(100, (done / total) * 100) : 0;
    $("progress-bar").style.width = pct + "%";
    $("progress-text").textContent = `${done} de ${total} anúncios coletados…`;
  }

  function showError(msg) {
    $("progress-card").classList.add("hidden");
    $("error-card").classList.remove("hidden");
    $("error-text").textContent = msg;
  }

  async function run() {
    $("error-card").classList.add("hidden");
    $("result-card").classList.add("hidden");

    const query = $("query").value.trim();
    const target = parseInt($("sample-size").value, 10);
    if (!query && !state.selected) {
      showError("Escolha uma categoria ou digite uma palavra-chave.");
      return;
    }

    $("progress-card").classList.remove("hidden");
    $("btn-run").disabled = true;
    setProgress(0, target);
    $("progress-text").textContent = "Lendo páginas do Mercado Livre… (com pausa entre elas)";

    try {
      const { total, results } = await MLScrape.scrapeSearch(
        { query, categoryId: state.selected ? state.selected.id : "", target },
        setProgress
      );
      if (!results.length) {
        throw new Error("Nenhum anúncio encontrado. Tente outra palavra-chave ou categoria.");
      }
      const meta = {
        site: "MLB · Brasil",
        categoryId: state.selected ? state.selected.id : "",
        categoryName: state.selected ? state.selected.name : "",
        query,
        total,
        date: new Date().toLocaleString("pt-BR"),
      };
      const analysis = Analysis.run(meta, results);
      state.lastAnalysis = analysis;
      renderResult(analysis);
    } catch (e) {
      if (e && e.blocked) {
        showError(
          "O Mercado Livre exibiu uma verificação anti-bot. Abra o site mercadolivre.com.br " +
          "normalmente no navegador (resolva qualquer verificação) e tente de novo; " +
          "reduza a quantidade de anúncios se persistir."
        );
      } else {
        showError(e.message || String(e));
      }
    } finally {
      $("progress-card").classList.add("hidden");
      $("btn-run").disabled = false;
    }
  }

  /* ---------- Resultado ---------- */
  const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function metric(v, k) { return `<div class="metric"><div class="v">${v}</div><div class="k">${k}</div></div>`; }

  function renderResult(a) {
    const s = a.summary;
    $("result-card").classList.remove("hidden");
    $("result-subtitle").textContent =
      `${s.Categoria}${s.PalavraChave ? " · “" + s.PalavraChave + "”" : ""} — ${s.AnunciosAnalisados} anúncios analisados.`;

    $("summary-cards").innerHTML = [
      metric(s.AnunciosAnalisados, "Anúncios analisados"),
      metric(brl(s.PrecoMedio), "Preço médio"),
      metric(brl(s.PrecoMediano), "Preço mediano"),
      metric(brl(s.PrecoMinimo), "Preço mínimo"),
      metric(brl(s.PrecoMaximo), "Preço máximo"),
      metric(s.FreteGratisPct + "%", "Frete grátis"),
    ].join("");

    const cols = ["Titulo", "Preco", "FreteGratis", "Vendedor"];
    const head = $("preview-table").querySelector("thead");
    const body = $("preview-table").querySelector("tbody");
    head.innerHTML = "<tr>" + cols.map((c) => `<th class="${c === "Preco" ? "num" : ""}">${c}</th>`).join("") + "</tr>";
    const preview = a.rows.slice(0, 50);
    body.innerHTML = preview.map((r) =>
      "<tr>" + cols.map((c) => {
        let v = r[c];
        if (c === "Preco") v = brl(v);
        const cls = c === "Preco" ? "num" : "";
        return `<td class="${cls}">${String(v ?? "").replace(/</g, "&lt;")}</td>`;
      }).join("") + "</tr>"
    ).join("");

    $("preview-note").textContent =
      `Mostrando ${preview.length} de ${a.rows.length} linhas. A planilha tem 4 abas (Resumo, Anúncios, Vendedores, Faixas de preço).`;
  }

  function exportXlsx() {
    if (!state.lastAnalysis) return;
    const s = state.lastAnalysis.summary;
    const slug = (s.PalavraChave || s.CategoriaID || "mercado").toString().replace(/[^\w-]+/g, "_").slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    Exporter.download(state.lastAnalysis, `analise_${slug}_${stamp}.xlsx`);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("btn-run").addEventListener("click", run);
    $("btn-export").addEventListener("click", exportXlsx);
    initCategories();
  });
})();
