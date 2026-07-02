# Análise de Mercado · Mercado Livre

Plataforma de insights de anúncios do Mercado Livre: você digita o **título /
palavra-chave**, ela conecta na **API do Mercado Livre com a sua aplicação**
(Client ID/Secret) e traz **preço, nº de vendas, receita estimada, vendedor,
frete** etc., com **planilha tratada (.xlsx)** no final.

## Como funciona a coleta (endpoint `/insights/search`)

O servidor tenta as fontes nesta ordem, usando o token OAuth da sua aplicação:

1. **Busca oficial** `GET /sites/MLB/search?q=…` — melhor fonte: já traz
   `sold_quantity` (nº de vendas) por anúncio. Algumas aplicações não têm
   acesso a este endpoint (retorna 403); nesse caso:
2. **Raspagem das páginas públicas** (`lista.mercadolivre.com.br`) para
   descobrir os anúncios do título, **+ enriquecimento via API oficial de
   itens** (`GET /items?ids=…`, 20 por chamada) para trazer o **nº de vendas**,
   preço oficial, condição, estoque etc. de cada anúncio.
3. Sem login, roda só a raspagem (sem nº de vendas) — o app avisa.

Para ver o que a **sua** aplicação consegue acessar, abra:

```
http://localhost:3000/insights/debug?q=fone%20bluetooth
```

## Como rodar

```bash
cp .env.example .env    # preencha ML_CLIENT_ID e ML_CLIENT_SECRET da sua app
node server.js          # ou npm start
```

Abra <http://localhost:3000>, clique em **Conectar ao Mercado Livre** (banner no
topo), autorize, digite o **título** que quer analisar e clique em
**🔎 Analisar mercado**. Depois é só **⬇️ Baixar planilha (.xlsx)**.

> Sua aplicação precisa ter o redirect URI `http://localhost:3000/auth/callback`
> cadastrado (veja "Modo desenvolvedor" abaixo).

### Se der erro / vier vazio (diagnóstico)

O HTML do Mercado Livre muda com o tempo. Para conferir o que está chegando,
abra no navegador (ajuste a palavra-chave):

```
http://localhost:3000/scrape/debug?q=fone%20bluetooth
```

Isso mostra status, se foi bloqueado (anti-bot), quantos anúncios o parser
encontrou e uma amostra do HTML — útil para reajustar o parser em
[`scrape.js`](scrape.js).

### Limites e cuidados da raspagem

- **Anti-bot:** rodar da sua máquina (IP residencial/empresa) ajuda. Há um
  intervalo entre páginas para não ser barrado; se vier bloqueio (403/429),
  espere alguns minutos e reduza a quantidade.
- **Dados:** vêm título, preço, link, frete grátis e (quando disponível)
  vendedor. Campos como quantidade vendida e condição não aparecem na listagem.
- **ToS:** é uma zona cinzenta dos Termos de Uso; use para pesquisa interna.

---

## App desktop (macOS) — para compartilhar com o time

O app roda um servidor interno em `localhost`, faz o OAuth do Mercado Livre
(localhost dispensa https), guarda o token **localmente em cada máquina** e pode
exigir **senha** na abertura. Como cada instalação faz a própria autorização,
todos podem usar a **mesma conta do Mercado Livre** sem um derrubar o token do
outro.

- **Como gerar e distribuir o `.app`/`.dmg`:** veja **[DESKTOP.md](DESKTOP.md)**.
- ⚠️ O `Client Secret` fica embutido no app — use só para **distribuição
  interna** (time confiável), nunca público.

---

## Modo desenvolvedor: servidor local (token automático)

### 1. Crie sua aplicação no Mercado Livre
1. Acesse <https://developers.mercadolivre.com.br/devcenter> e crie uma aplicação.
2. Em **URIs de redirect**, cadastre **exatamente**:
   `http://localhost:3000/auth/callback`
3. Anote o **Client ID** e o **Client Secret**.

### 2. Configure as credenciais
```bash
cp .env.example .env
# edite o .env e preencha ML_CLIENT_ID e ML_CLIENT_SECRET
```

### 3. Rode o servidor
```bash
node server.js
# ou: npm start
```

**No Mac:** dê **duplo-clique** em `start-mac.command` (ele sobe o servidor e abre
o navegador sozinho). Na primeira vez, se o macOS bloquear, clique com o botão
direito → **Abrir**. Requer Node instalado (<https://nodejs.org>, versão LTS).

Abra <http://localhost:3000>, clique em **“Conectar ao Mercado Livre”**, autorize,
e pronto — o token passa a ser renovado automaticamente.

### 4. Use
1. Em **1. Escolha a categoria**, selecione a categoria e, se quiser, aprofunde
   nas subcategorias. Opcionalmente informe **palavra-chave**, **condição**
   (novo/usado), **quantidade de anúncios** e **ordenação**.
2. Clique em **🔎 Analisar mercado** e depois em **⬇️ Baixar planilha (.xlsx)**.

> O frontend **detecta o backend automaticamente** (via `/auth/status`) e roteia
> as chamadas pelo proxy `/api`, sem expor o token no navegador.

## Modo alternativo: sem backend (token manual)

Dá para abrir o `index.html` direto / por um servidor estático. As categorias
carregam, mas a **busca exige token** — gere um Access Token (`APP_USR-…`) e cole
em ⚙️ **Configurações**. Ele vale ~6h e fica salvo só no seu navegador.

Use o botão **🔌 Testar conexão** (em ⚙️ Configurações) para checar o status
exato de cada endpoint (categorias e busca).

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

## Como o OAuth funciona (backend)

`server.js` faz o fluxo *Authorization Code*:

1. **`/auth/login`** → redireciona para a tela de autorização do Mercado Livre.
2. **`/auth/callback`** → troca o `code` por `access_token` + `refresh_token`,
   salvos em `tokens.json` (ignorado pelo git).
3. **`/api/*`** → proxy para `https://api.mercadolibre.com/*`, injetando o
   `Authorization: Bearer`. Se o token estiver perto de expirar, o servidor o
   **renova automaticamente** via `refresh_token` antes de repassar a chamada.

As credenciais (`.env`) e os tokens (`tokens.json`) **ficam só no servidor** —
o navegador nunca os vê.

## Estrutura

```
server.js          # backend mínimo: OAuth + proxy + arquivos estáticos
.env.example       # modelo de credenciais (copie para .env)
package.json
index.html
assets/
  css/styles.css
  js/
    api.js        # cliente da API + rate limiter + retry + detecção de backend
    analysis.js   # tratamento e métricas dos dados
    export.js     # geração do .xlsx (SheetJS)
    app.js        # interface, navegação de categorias, fluxo, login
```

## Dependências

- **Backend:** nenhuma. Só Node 18+ (usa `fetch` nativo), sem `npm install`.
- **Frontend:** [SheetJS](https://sheetjs.com/) via CDN, para gerar o `.xlsx`.

## Observações

- `sold_quantity` (qtd. vendida) pode vir zerado dependendo da versão/política
  da API; quando disponível, alimenta a "receita estimada".
- Sites suportados: MLB (Brasil), MLA, MLM, MLC, MCO, MLU.
