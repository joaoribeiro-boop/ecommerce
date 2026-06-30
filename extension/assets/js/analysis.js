/* =====================================================================
 * analysis.js — Tratamento e análise dos dados brutos da API
 * ---------------------------------------------------------------------
 * Recebe os `results` da busca e devolve:
 *  - rows: linhas tratadas (1 por anúncio) prontas pra planilha
 *  - summary: métricas agregadas do mercado
 *  - sellers: ranking de vendedores
 *  - priceBuckets: distribuição por faixa de preço
 * ===================================================================== */

const Analysis = (function () {

  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
  }

  // Mapa amigável de tipos de anúncio
  const LISTING_LABELS = {
    gold_pro: "Premium",
    gold_premium: "Premium (antigo)",
    gold_special: "Clássico",
    gold: "Ouro",
    silver: "Prata",
    bronze: "Bronze",
    free: "Grátis",
  };

  // Transforma um item da API numa linha tratada.
  function toRow(it) {
    const ship = it.shipping || {};
    const seller = it.seller || {};
    const addr = it.address || it.seller_address || {};
    const installments = it.installments || {};

    return {
      ID: it.id || "",
      Titulo: it.title || "",
      Preco: num(it.price),
      PrecoOriginal: num(it.original_price) || num(it.price),
      Moeda: it.currency_id || "",
      Condicao: it.condition === "new" ? "Novo" : it.condition === "used" ? "Usado" : (it.condition || ""),
      QtdVendida: num(it.sold_quantity),
      QtdDisponivel: num(it.available_quantity),
      FreteGratis: ship.free_shipping ? "Sim" : "Não",
      FullDoML: (ship.logistic_type === "fulfillment") ? "Sim" : "Não",
      TipoAnuncio: LISTING_LABELS[it.listing_type_id] || it.listing_type_id || "",
      Parcelas: installments.quantity ? `${installments.quantity}x` : "",
      Vendedor: seller.nickname || (seller.id ? `#${seller.id}` : ""),
      VendedorID: seller.id || "",
      UF: addr.state_name || addr.state_id || "",
      Cidade: addr.city_name || addr.city_id || "",
      Catalogo: it.catalog_listing ? "Sim" : "Não",
      Link: it.permalink || "",
      ReceitaEstimada: num(it.price) * num(it.sold_quantity),
    };
  }

  function buildPriceBuckets(prices) {
    if (!prices.length) return [];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) {
      return [{ Faixa: `R$ ${min.toFixed(2)}`, Quantidade: prices.length }];
    }
    const N = 8;
    const step = (max - min) / N;
    const buckets = Array.from({ length: N }, (_, i) => ({
      lo: min + i * step,
      hi: min + (i + 1) * step,
      count: 0,
    }));
    for (const p of prices) {
      let idx = Math.floor((p - min) / step);
      if (idx >= N) idx = N - 1;
      buckets[idx].count++;
    }
    return buckets.map((b) => ({
      Faixa: `R$ ${b.lo.toFixed(0)} – R$ ${b.hi.toFixed(0)}`,
      Quantidade: b.count,
    }));
  }

  function buildSellers(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = r.Vendedor || r.VendedorID || "(desconhecido)";
      const cur = map.get(key) || { Vendedor: key, Anuncios: 0, SomaPreco: 0, Vendas: 0 };
      cur.Anuncios++;
      cur.SomaPreco += r.Preco;
      cur.Vendas += r.QtdVendida;
      map.set(key, cur);
    }
    return [...map.values()]
      .map((s) => ({
        Vendedor: s.Vendedor,
        Anuncios: s.Anuncios,
        PrecoMedio: +(s.SomaPreco / s.Anuncios).toFixed(2),
        QtdVendidaTotal: s.Vendas,
      }))
      .sort((a, b) => b.Anuncios - a.Anuncios)
      .slice(0, 25);
  }

  // Função principal
  function run(meta, results) {
    const rows = results.map(toRow);
    const prices = rows.map((r) => r.Preco).filter((p) => p > 0);
    const sold = rows.map((r) => r.QtdVendida);

    const freeShip = rows.filter((r) => r.FreteGratis === "Sim").length;
    const novos = rows.filter((r) => r.Condicao === "Novo").length;
    const usados = rows.filter((r) => r.Condicao === "Usado").length;
    const full = rows.filter((r) => r.FullDoML === "Sim").length;
    const catalogo = rows.filter((r) => r.Catalogo === "Sim").length;

    const summary = {
      Categoria: meta.categoryName || "(busca livre)",
      CategoriaID: meta.categoryId || "",
      PalavraChave: meta.query || "",
      Site: meta.site,
      DataAnalise: meta.date,
      TotalNaCategoria: meta.total,
      AnunciosAnalisados: rows.length,
      PrecoMinimo: prices.length ? +Math.min(...prices).toFixed(2) : 0,
      PrecoMaximo: prices.length ? +Math.max(...prices).toFixed(2) : 0,
      PrecoMedio: +mean(prices).toFixed(2),
      PrecoMediano: +median(prices).toFixed(2),
      DesvioPadraoPreco: +stdDev(prices).toFixed(2),
      FreteGratisPct: rows.length ? +((freeShip / rows.length) * 100).toFixed(1) : 0,
      FullDoMLPct: rows.length ? +((full / rows.length) * 100).toFixed(1) : 0,
      CatalogoPct: rows.length ? +((catalogo / rows.length) * 100).toFixed(1) : 0,
      Novos: novos,
      Usados: usados,
      VendasSomadas: sold.reduce((a, b) => a + b, 0),
      ReceitaEstimadaTotal: +rows.reduce((a, r) => a + r.ReceitaEstimada, 0).toFixed(2),
    };

    return {
      summary,
      rows,
      sellers: buildSellers(rows),
      priceBuckets: buildPriceBuckets(prices),
    };
  }

  return { run };
})();
