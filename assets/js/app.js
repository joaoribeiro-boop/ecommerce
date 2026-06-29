/* =====================================================================
 * app.js — Orquestra a interface
 * ---------------------------------------------------------------------
 * - Carrega categorias e permite navegar pelas subcategorias
 * - Dispara a coleta respeitando o rate limit
 * - Mostra progresso, resumo e prévia
 * - Aciona o download da planilha .xlsx
 * ===================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SITES_LABEL = { MLB: "Brasil", MLA: "Argentina", MLM: "México", MLC: "Chile", MCO: "Colômbia", MLU: "Uruguai" };

  // Estado da seleção de categoria: caminho (breadcrumb) + categoria atual selecionada.
  const state = {
    path: [],            // [{id, name}]
    selected: null,      // {id, name} categoria escolhida para análise
    lastAnalysis: null,  // resultado para exportar
  };

  /* ---------- Configurações (localStorage) ---------- */
  function loadSettings() {
    const rate = localStorage.getItem("ml_rate");
    const token = localStorage.getItem("ml_token");
    const site = localStorage.getItem("ml_site");
    if (rate) $("rate").value = rate;
    if (token) $("token").value = token;
    if (site) $("site").value = site;
    ML.setRate(parseInt($("rate").value, 10) || 4);
    ML.setToken($("token").value.trim());
  }

  function saveSettings() {
    localStorage.setItem("ml_rate", $("rate").value);
    localStorage.setItem("ml_token", $("token").value.trim());
    localStorage.setItem("ml_site", $("site").value);
    ML.setRate(parseInt($("rate").value, 10) || 4);
    ML.setToken($("token").value.trim());
    $("settings").classList.add("hidden");
    // Recarrega categorias caso o site tenha mudado.
    initCategories();
  }

  /* ---------- Erros ---------- */
  function showError(err) {
    $("progress-card").classList.add("hidden");
    const el = $("error-card");
    el.classList.remove("hidden");
    let msg;
    if (err instanceof ML.MLError) {
      if (err.kind === "network") {
        msg = "Falha de rede ou bloqueio de CORS ao chamar a API. " +
          "Verifique sua conexão. Se persistir, a API pode exigir um Access Token (⚙️ Configurações).";
      } else if (err.status === 401 || err.status === 403) {
        msg = `A API recusou a requisição (HTTP ${err.status}). ` +
          "Este endpoint provavelmente exige autenticação. Gere um Access Token do Mercado Livre " +
          "e cole em ⚙️ Configurações. Detalhe: " + err.detail;
      } else if (err.status === 429) {
        msg = "Você atingiu o limite de requisições (HTTP 429). Reduza o 'req/s' em Configurações e tente de novo.";
      } else {
        msg = `Erro da API (HTTP ${err.status}). Detalhe: ${err.detail}`;
      }
    } else {
      msg = err.message || String(err);
    }
    $("error-text").textContent = msg;
  }

  function clearError() { $("error-card").classList.add("hidden"); }

  /* ---------- Categorias ---------- */
  async function initCategories() {
    state.path = [];
    state.selected = null;
    $("btn-run").disabled = true;
    $("category-loading").classList.remove("hidden");
    $("category-loading").textContent = "Carregando categorias…";
    $("category-path").innerHTML = "";
    clearError();

    try {
      const site = $("site").value;
      const cats = await ML.categories(site);
      renderCategorySelect(cats, true);
      $("category-loading").classList.add("hidden");
    } catch (err) {
      $("category-loading").classList.add("hidden");
      showError(err);
    }
  }

  // Renderiza o breadcrumb + o <select> do nível atual.
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

    // Remove select anterior, se houver.
    const old = document.querySelector(".cat-select");
    if (old) old.remove();

    if (!children || !children.length) return; // folha: sem subcategorias

    const sel = document.createElement("select");
    sel.className = "cat-select";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = isRoot ? "Selecione uma categoria…" : "Selecione uma subcategoria… (ou analise a atual)";
    sel.appendChild(ph);

    children.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name + (c.total_items_in_this_category != null ? ` (${c.total_items_in_this_category.toLocaleString("pt-BR")})` : "");
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
    $("btn-run").disabled = false; // já dá pra analisar este nível

    // Busca subcategorias (filhas) para permitir aprofundar.
    $("category-loading").classList.remove("hidden");
    $("category-loading").textContent = "Carregando subcategorias…";
    try {
      const detail = await ML.category(id);
      $("category-loading").classList.add("hidden");
      renderCategorySelect(detail.children_categories || [], false);
    } catch (err) {
      $("category-loading").classList.add("hidden");
      // Não é fatal: ainda dá pra analisar a categoria escolhida.
      renderCategorySelect([], false);
    }
  }

  /* ---------- Execução da análise ---------- */
  function setProgress(done, total) {
    const pct = total ? Math.min(100, (done / total) * 100) : 0;
    $("progress-bar").style.width = pct + "%";
    $("progress-text").textContent = `${done} de ${total} anúncios coletados…`;
  }

  async function run() {
    clearError();
    const site = $("site").value;
    const query = $("query").value.trim();
    const condition = $("condition").value;
    const sort = $("sort").value;
    const target = parseInt($("sample-size").value, 10);

    if (!state.selected && !query) {
      showError(new Error("Escolha uma categoria ou informe uma palavra-chave."));
      return;
    }

    $("result-card").classList.add("hidden");
    $("progress-card").classList.remove("hidden");
    $("btn-run").disabled = true;
    setProgress(0, target);

    try {
      const q = {
        category: state.selected ? state.selected.id : "",
        q: query,
        condition,
        sort,
      };
      const { total, results } = await ML.collect(site, q, target, setProgress);

      if (!results.length) {
        throw new Error("Nenhum anúncio encontrado para esses filtros.");
      }

      const meta = {
        site: `${site} · ${SITES_LABEL[site] || ""}`.trim(),
        categoryId: state.selected ? state.selected.id : "",
        categoryName: state.selected ? state.selected.name : "",
        query,
        total,
        date: new Date().toLocaleString("pt-BR"),
      };

      const analysis = Analysis.run(meta, results);
      state.lastAnalysis = analysis;
      renderResult(analysis);
    } catch (err) {
      showError(err);
    } finally {
      $("progress-card").classList.add("hidden");
      $("btn-run").disabled = false;
    }
  }

  /* ---------- Renderização do resultado ---------- */
  function metric(value, label) {
    return `<div class="metric"><div class="v">${value}</div><div class="k">${label}</div></div>`;
  }
  const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function renderResult(a) {
    const s = a.summary;
    $("result-card").classList.remove("hidden");
    $("result-subtitle").textContent =
      `${s.Categoria}${s.PalavraChave ? " · “" + s.PalavraChave + "”" : ""} — ` +
      `${s.AnunciosAnalisados} anúncios analisados de ${Number(s.TotalNaCategoria).toLocaleString("pt-BR")} no total.`;

    $("summary-cards").innerHTML = [
      metric(Number(s.TotalNaCategoria).toLocaleString("pt-BR"), "Total na categoria"),
      metric(brl(s.PrecoMedio), "Preço médio"),
      metric(brl(s.PrecoMediano), "Preço mediano"),
      metric(brl(s.PrecoMinimo), "Preço mínimo"),
      metric(brl(s.PrecoMaximo), "Preço máximo"),
      metric(s.FreteGratisPct + "%", "Frete grátis"),
      metric(s.FullDoMLPct + "%", "Full do ML"),
      metric(s.Novos + " / " + s.Usados, "Novos / Usados"),
      metric(Number(s.VendasSomadas).toLocaleString("pt-BR"), "Vendas somadas"),
    ].join("");

    // Prévia (até 50 linhas).
    const cols = ["Titulo", "Preco", "Condicao", "FreteGratis", "QtdVendida", "Vendedor", "UF"];
    const head = $("preview-table").querySelector("thead");
    const body = $("preview-table").querySelector("tbody");
    head.innerHTML = "<tr>" + cols.map((c) => `<th class="${c === "Preco" || c === "QtdVendida" ? "num" : ""}">${c}</th>`).join("") + "</tr>";
    const preview = a.rows.slice(0, 50);
    body.innerHTML = preview.map((r) =>
      "<tr>" + cols.map((c) => {
        let v = r[c];
        if (c === "Preco") v = brl(v);
        const cls = (c === "Preco" || c === "QtdVendida") ? "num" : "";
        return `<td class="${cls}">${String(v ?? "").replace(/</g, "&lt;")}</td>`;
      }).join("") + "</tr>"
    ).join("");

    $("preview-note").textContent =
      `Mostrando ${preview.length} de ${a.rows.length} linhas. A planilha completa tem 4 abas (Resumo, Anúncios, Vendedores, Faixas de preço).`;
  }

  function exportXlsx() {
    if (!state.lastAnalysis) return;
    const s = state.lastAnalysis.summary;
    const slug = (s.CategoriaID || s.PalavraChave || "mercado")
      .toString().replace(/[^\w-]+/g, "_").slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    Exporter.download(state.lastAnalysis, `analise_${slug}_${stamp}.xlsx`);
  }

  /* ---------- Bind de eventos ---------- */
  function init() {
    loadSettings();

    $("btn-settings").addEventListener("click", () => $("settings").classList.toggle("hidden"));
    $("btn-save-settings").addEventListener("click", saveSettings);
    $("btn-run").addEventListener("click", run);
    $("btn-export").addEventListener("click", exportXlsx);

    initCategories();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
