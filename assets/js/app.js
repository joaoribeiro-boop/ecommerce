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
    lastMeta: null,      // fonte dos dados / avisos da última coleta
  };

  // Habilita o botão quando há palavra-chave OU categoria selecionada.
  function refreshRunButton() {
    const hasQuery = $("query").value.trim().length > 0;
    $("btn-run").disabled = !(hasQuery || state.selected);
  }

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

  /* ---------- Diagnóstico de conexão ---------- */
  async function testConnection() {
    const box = $("test-result");
    box.classList.remove("hidden");
    box.innerHTML = "<div class='line'>Testando…</div>";
    const site = $("site").value;
    const token = $("token").value.trim();
    const lines = [];

    // Estado do token
    lines.push(`<div class="line">${token ? "🔑" : "⚪"} Token: <strong>${token ? "configurado" : "nenhum"}</strong></div>`);

    // 1) Categorias (público)
    let firstCat = "MLB1051";
    try {
      const cats = await ML.categories(site);
      firstCat = (cats && cats[0] && cats[0].id) || firstCat;
      lines.push(`<div class="line"><span class="ok">✅</span> Categorias: <strong>OK</strong> (${cats.length} categorias)</div>`);
    } catch (e) {
      const st = e.status != null ? e.status : "—";
      lines.push(`<div class="line"><span class="bad">❌</span> Categorias: <strong>falhou</strong> — <code>${e.kind === "network" ? "rede/CORS" : "HTTP " + st}</code></div>`);
    }

    // 2) Busca (exige token na política atual)
    let searchStatus = null, searchKind = null;
    try {
      const page = await ML.searchPage(site, { category: firstCat, limit: 1 });
      const n = page && page.paging ? page.paging.total : 0;
      lines.push(`<div class="line"><span class="ok">✅</span> Busca: <strong>OK</strong> (${Number(n).toLocaleString("pt-BR")} anúncios na categoria de teste)</div>`);
    } catch (e) {
      searchStatus = e.status; searchKind = e.kind;
      const st = e.status != null ? e.status : "—";
      lines.push(`<div class="line"><span class="bad">❌</span> Busca: <strong>falhou</strong> — <code>${e.kind === "network" ? "rede/CORS" : "HTTP " + st}</code></div>`);
    }

    // Diagnóstico/recomendação
    let hint = "";
    if (searchStatus === 401 || searchStatus === 403) {
      hint = "A busca exige <strong>Access Token</strong>. Cole um token válido (APP_USR-…) no campo acima e clique em Salvar. " +
        "A API do Mercado Livre não permite mais busca anônima.";
    } else if (searchKind === "network") {
      hint = "Erro de <strong>rede/CORS</strong>: o navegador bloqueou a chamada. Isso ocorre mais quando você abre o arquivo direto " +
        "(<code>file://</code>). Tente servir por <code>http://localhost</code> (veja o README) ou use um proxy.";
    } else if (searchStatus === 429) {
      hint = "Limite de requisições atingido (429). Reduza o <strong>req/s</strong> e tente de novo.";
    } else if (searchStatus != null) {
      hint = `A busca retornou <code>HTTP ${searchStatus}</code>. Veja o detalhe no Console (F12).`;
    }
    if (hint) lines.push(`<div class="hint">💡 ${hint}</div>`);

    box.innerHTML = lines.join("");
  }

  /* ---------- Erros ---------- */
  function showError(err) {
    $("progress-card").classList.add("hidden");
    const el = $("error-card");
    el.classList.remove("hidden");
    let msg;
    if (err instanceof ML.MLError) {
      if (err.kind === "blocked") {
        msg = "O Mercado Livre bloqueou a raspagem (anti-bot). Espere alguns minutos e tente de novo, " +
          "reduza a quantidade de anúncios, ou diminua a frequência. Detalhe: " + err.detail;
      } else if (err.kind === "network") {
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
    refreshRunButton();
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
      // Categoria é opcional: não bloqueia a pesquisa por título.
      $("category-loading").textContent =
        "Não foi possível carregar as categorias (tudo bem — pesquise só pelo título).";
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
    refreshRunButton(); // já dá pra analisar este nível

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

      let total, results, source = "", enriched = false, warnings = [];
      if (ML.config.useProxy) {
        // Insights via backend: API oficial (token da aplicação) e, se a
        // busca oficial não estiver liberada, raspagem + API de itens.
        $("progress-text").textContent =
          "Consultando o Mercado Livre… isso pode levar alguns segundos.";
        const data = await ML.searchInsights({ ...q, site }, target, setProgress);
        ({ total, results } = data);
        source = data.source || "";
        enriched = Boolean(data.enriched);
        warnings = data.warnings || [];
      } else {
        // Sem backend não há como buscar (CORS / token).
        throw new Error(
          "A análise precisa do servidor local. Rode 'node server.js' e abra http://localhost:3000."
        );
      }

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
      state.lastMeta = { source, enriched, warnings };
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
      metric(Number(s.TotalNaCategoria).toLocaleString("pt-BR"), "Total encontrado"),
      metric(brl(s.PrecoMedio), "Preço médio"),
      metric(brl(s.PrecoMediano), "Preço mediano"),
      metric(brl(s.PrecoMinimo), "Preço mínimo"),
      metric(brl(s.PrecoMaximo), "Preço máximo"),
      metric(Number(s.VendasSomadas).toLocaleString("pt-BR"), "Vendas somadas"),
      metric(brl(s.ReceitaEstimadaTotal), "Receita estimada"),
      metric(s.FreteGratisPct + "%", "Frete grátis"),
      metric(s.Novos + " / " + s.Usados, "Novos / Usados"),
    ].join("");

    // Prévia (até 50 linhas).
    const numCols = ["Preco", "QtdVendida", "ReceitaEstimada"];
    const cols = ["Titulo", "Preco", "QtdVendida", "ReceitaEstimada", "Condicao", "FreteGratis", "Vendedor"];
    const head = $("preview-table").querySelector("thead");
    const body = $("preview-table").querySelector("tbody");
    head.innerHTML = "<tr>" + cols.map((c) => `<th class="${numCols.includes(c) ? "num" : ""}">${c}</th>`).join("") + "</tr>";
    const preview = a.rows.slice(0, 50);
    body.innerHTML = preview.map((r) =>
      "<tr>" + cols.map((c) => {
        let v = r[c];
        if (c === "Preco" || c === "ReceitaEstimada") v = brl(v);
        const cls = numCols.includes(c) ? "num" : "";
        return `<td class="${cls}">${String(v ?? "").replace(/</g, "&lt;")}</td>`;
      }).join("") + "</tr>"
    ).join("");

    // Nota sobre a fonte dos dados + avisos do backend.
    const m = state.lastMeta || {};
    const SOURCE_LABEL = {
      "api": "Fonte: busca oficial da API do Mercado Livre (nº de vendas oficial).",
      "scrape+api": "Fonte: páginas públicas do Mercado Livre + API oficial de itens (nº de vendas oficial).",
      "scrape": "Fonte: páginas públicas do Mercado Livre — sem nº de vendas. Conecte sua aplicação para habilitar.",
    };
    const notes = [
      `Mostrando ${preview.length} de ${a.rows.length} linhas. A planilha completa tem 4 abas (Resumo, Anúncios, Vendedores, Faixas de preço).`,
      SOURCE_LABEL[m.source] || "",
      ...(m.warnings || []).map((w) => "⚠️ " + w),
    ].filter(Boolean);
    $("preview-note").innerHTML = notes.map((n) => String(n).replace(/</g, "&lt;")).join("<br>");
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
  function renderAuthBanner(status) {
    const el = $("auth-banner");
    el.classList.remove("hidden", "ok", "warn");

    if (!status.hasCredentials) {
      el.classList.add("warn");
      el.innerHTML =
        "⚠️ <strong>Credenciais da aplicação não configuradas.</strong> " +
        "Copie <code>.env.example</code> para <code>.env</code>, preencha <code>ML_CLIENT_ID</code> e " +
        "<code>ML_CLIENT_SECRET</code> da sua aplicação e reinicie o servidor. " +
        "Sem isso a análise roda só por raspagem, <strong>sem nº de vendas</strong>.";
      return;
    }
    if (!status.authenticated) {
      el.classList.add("warn");
      el.innerHTML =
        "🔑 <strong>Conecte sua aplicação do Mercado Livre</strong> para trazer o " +
        "<strong>nº de vendas</strong> e os dados oficiais dos anúncios. " +
        '<div style="margin-top:10px"><a class="btn-link" href="/auth/login">Conectar ao Mercado Livre</a></div>';
      return;
    }
    el.classList.add("ok");
    el.innerHTML =
      "✅ <strong>Conectado ao Mercado Livre</strong> — insights com preço e nº de vendas oficiais. " +
      '<a class="btn-link muted-link" href="/auth/logout">Desconectar</a>';
  }

  async function init() {
    loadSettings();

    $("btn-settings").addEventListener("click", () => $("settings").classList.toggle("hidden"));
    $("btn-save-settings").addEventListener("click", saveSettings);
    $("btn-test").addEventListener("click", testConnection);
    $("btn-run").addEventListener("click", run);
    $("btn-export").addEventListener("click", exportXlsx);
    $("query").addEventListener("input", refreshRunButton);
    $("query").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !$("btn-run").disabled) run();
    });

    // Detecta o backend antes de chamar a API.
    const backend = await ML.detectBackend();
    if (backend) {
      renderAuthBanner(backend);
      // No modo backend o token é gerenciado pelo servidor: oculta o campo.
      const tokenLabel = $("token").closest("label");
      if (tokenLabel) tokenLabel.classList.add("hidden");
    }

    initCategories();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
