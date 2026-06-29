# Análise de Mercado · Mercado Livre

Agente **100% client-side** (HTML + JavaScript, sem backend) que faz pesquisa de
mercado batendo na **API do Mercado Livre**, respeitando o limite de requisições
para evitar bloqueio, e gera uma **planilha tratada (.xlsx)** filtrada por
categoria.

## Como usar

1. Abra o `index.html` no navegador.
   - **Recomendado:** sirva por um servidor local para evitar restrições do
     `file://`:
     ```bash
     python3 -m http.server 8000
     # abra http://localhost:8000
     ```
2. Em **1. Escolha a categoria**, selecione a categoria e, se quiser, aprofunde
   nas subcategorias. Opcionalmente informe uma **palavra-chave**, **condição**
   (novo/usado), **quantidade de anúncios** e **ordenação**.
3. Clique em **🔎 Analisar mercado**. O app coleta os dados com controle de
   ritmo e mostra um resumo + prévia.
4. Clique em **⬇️ Baixar planilha (.xlsx)**.

## A planilha gerada (4 abas)

| Aba | Conteúdo |
|-----|----------|
| **Resumo** | Métricas do mercado: preço mín/máx/médio/mediano, desvio padrão, % frete grátis, % Full do ML, novos vs. usados, vendas somadas, receita estimada. |
| **Anúncios** | 1 linha por anúncio (tratado), com autofiltro: título, preço, condição, frete, vendedor, UF/cidade, link etc. |
| **Vendedores** | Ranking dos vendedores por nº de anúncios, com preço médio. |
| **Faixas de preço** | Distribuição dos anúncios por faixa (histograma). |

## Controle de requisições (anti-bloqueio)

Em `assets/js/api.js`:

- **Fila sequencial** com intervalo mínimo entre chamadas (padrão **4 req/s**,
  ajustável em ⚙️ Configurações).
- **Retry com backoff exponencial** (1s, 2s, 4s, 8s) em `429` e `5xx`,
  respeitando o header `Retry-After`.
- Paginação respeitando o teto da busca pública (`offset + limit ≤ 1000`,
  `limit ≤ 50`).

Se você ver **HTTP 429**, reduza o "req/s" em Configurações.

## Autenticação (Access Token)

A API do Mercado Livre exige **OAuth** em vários endpoints. Se a busca falhar
com **401/403**, gere um token e cole em ⚙️ **Configurações** (fica salvo só no
seu navegador, em `localStorage`):

1. Crie uma aplicação em <https://developers.mercadolivre.com.br/devcenter>.
2. Siga o fluxo OAuth para obter um `access_token` (formato `APP_USR-...`).
3. Cole o token no campo **Access Token**.

> Endpoints de **categorias** (`/sites/MLB/categories`, `/categories/{id}`)
> normalmente são públicos; a **busca** (`/sites/MLB/search`) pode exigir token
> dependendo da política atual da API.

## Estrutura

```
index.html
assets/
  css/styles.css
  js/
    api.js        # cliente da API + rate limiter + retry
    analysis.js   # tratamento e métricas dos dados
    export.js     # geração do .xlsx (SheetJS)
    app.js        # interface, navegação de categorias, fluxo
```

## Dependências

- [SheetJS](https://sheetjs.com/) carregado via CDN (geração do `.xlsx` no
  navegador). Sem outras dependências, sem build.

## Observações

- `sold_quantity` (qtd. vendida) pode vir zerado dependendo da versão/política
  da API; quando disponível, alimenta a "receita estimada".
- Sites suportados: MLB (Brasil), MLA, MLM, MLC, MCO, MLU.
