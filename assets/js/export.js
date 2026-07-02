/* =====================================================================
 * export.js — Geração da planilha .xlsx no navegador (via SheetJS)
 * ---------------------------------------------------------------------
 * Abas geradas:
 *   1) Resumo         — métricas agregadas do mercado
 *   2) Anúncios       — dados tratados, 1 linha por anúncio (com autofiltro)
 *   3) Vendedores     — ranking por nº de anúncios
 *   4) Faixas de preço — distribuição (histograma)
 * ===================================================================== */

const Exporter = (function () {

  // Define larguras de coluna a partir do conteúdo (limitado).
  function autoWidth(rows, headers) {
    return headers.map((h) => {
      let w = h.length;
      for (const r of rows) {
        const v = r[h];
        const len = v == null ? 0 : String(v).length;
        if (len > w) w = len;
      }
      return { wch: Math.min(Math.max(w + 2, 8), 60) };
    });
  }

  function sheetFromObjects(rows, headers) {
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = autoWidth(rows, headers);
    // Autofiltro sobre o range usado.
    if (rows.length) ws["!autofilter"] = { ref: ws["!ref"] };
    return ws;
  }

  // Resumo em formato chave/valor (2 colunas) com rótulos amigáveis.
  function summarySheet(summary) {
    const labels = {
      Categoria: "Categoria",
      CategoriaID: "ID da categoria",
      PalavraChave: "Palavra-chave",
      Site: "Site",
      DataAnalise: "Data da análise",
      TotalNaCategoria: "Total de anúncios na categoria",
      AnunciosAnalisados: "Anúncios analisados (amostra)",
      PrecoMinimo: "Preço mínimo (R$)",
      PrecoMaximo: "Preço máximo (R$)",
      PrecoMedio: "Preço médio (R$)",
      PrecoMediano: "Preço mediano (R$)",
      DesvioPadraoPreco: "Desvio padrão do preço (R$)",
      FreteGratisPct: "% com frete grátis",
      FullDoMLPct: "% Full do ML (fulfillment)",
      CatalogoPct: "% em catálogo",
      Novos: "Anúncios novos",
      Usados: "Anúncios usados",
      VendasSomadas: "Vendas somadas (qtd)",
      ReceitaEstimadaTotal: "Receita estimada total (R$)",
    };
    const data = Object.keys(labels).map((k) => ({
      Métrica: labels[k],
      Valor: summary[k],
    }));
    const ws = XLSX.utils.json_to_sheet(data, { header: ["Métrica", "Valor"] });
    ws["!cols"] = [{ wch: 36 }, { wch: 28 }];
    return ws;
  }

  function build(analysis) {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, summarySheet(analysis.summary), "Resumo");

    const itemHeaders = [
      "Titulo", "Preco", "QtdVendida", "ReceitaEstimada", "Condicao",
      "CondicoesPagamento", "Frete", "Link", "PrecoOriginal", "FreteGratis",
      "QtdDisponivel", "TipoAnuncio", "Vendedor", "Catalogo", "ID",
    ];
    XLSX.utils.book_append_sheet(
      wb, sheetFromObjects(analysis.rows, itemHeaders), "Anúncios"
    );

    XLSX.utils.book_append_sheet(
      wb,
      sheetFromObjects(analysis.sellers, ["Vendedor", "Anuncios", "PrecoMedio", "QtdVendidaTotal"]),
      "Vendedores"
    );

    XLSX.utils.book_append_sheet(
      wb,
      sheetFromObjects(analysis.priceBuckets, ["Faixa", "Quantidade"]),
      "Faixas de preço"
    );

    return wb;
  }

  function download(analysis, filename) {
    const wb = build(analysis);
    XLSX.writeFile(wb, filename);
  }

  return { build, download };
})();
