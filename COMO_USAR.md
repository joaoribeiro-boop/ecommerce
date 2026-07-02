# Como abrir e usar a plataforma — passo a passo

## Parte 1 — Preparar (só na primeira vez)

### 1. Instale o Node.js
- Acesse <https://nodejs.org> e baixe a versão **LTS** (botão verde).
- Instale normalmente (avançar, avançar, concluir).
- Para conferir: abra o **Terminal** (Mac) ou o **Prompt de Comando** (Windows)
  e digite `node -v`. Deve aparecer algo como `v20.x.x`.

### 2. Baixe o código do projeto
Duas opções:

**Opção A — pelo navegador (mais fácil):**
1. Abra <https://github.com/joaoribeiro-boop/ecommerce>.
2. Troque a branch (botão no canto superior esquerdo, onde diz `main`) para
   `claude/mercado-livre-analytics-52uf8x`.
3. Clique no botão verde **Code → Download ZIP** e descompacte em uma pasta
   (ex.: `Documentos/ecommerce`).

**Opção B — pelo terminal:**
```bash
git clone https://github.com/joaoribeiro-boop/ecommerce.git
cd ecommerce
git checkout claude/mercado-livre-analytics-52uf8x
```

### 3. Configure a chave da sua aplicação do Mercado Livre
1. Na pasta do projeto, copie o arquivo `.env.example` e renomeie a cópia para
   **`.env`** (só isso, com o ponto na frente).
2. Abra o `.env` num editor de texto e preencha:
   ```
   ML_CLIENT_ID=  (o Client ID da sua aplicação)
   ML_CLIENT_SECRET=  (o Client Secret da sua aplicação)
   ```
   Esses dados estão em <https://developers.mercadolivre.com.br/devcenter>,
   dentro da sua aplicação.
3. Ainda no DevCenter, confira se a sua aplicação tem este **URI de redirect**
   cadastrado (tem que ser exatamente igual):
   ```
   http://localhost:3000/auth/callback
   ```
   Se não tiver, adicione e salve.

## Parte 2 — Abrir a plataforma (sempre que for usar)

### No Mac
- Dê **duplo-clique** no arquivo `start-mac.command` dentro da pasta do projeto.
  Ele liga o servidor e abre o navegador sozinho.
- Se o macOS bloquear na primeira vez: clique com o **botão direito → Abrir**.

### No Windows (ou se preferir o terminal no Mac)
1. Abra o terminal **dentro da pasta do projeto**
   (no Windows: abra a pasta no Explorer, clique na barra de endereço, digite
   `cmd` e aperte Enter).
2. Digite:
   ```bash
   node server.js
   ```
3. Vai aparecer `Análise de Mercado rodando em http://localhost:3000`.
4. Abra o navegador em **<http://localhost:3000>**.

> Para **fechar** a plataforma: feche a janela do terminal (ou aperte
> `Ctrl + C` nela). Para abrir de novo, repita esta Parte 2.

## Parte 3 — Usar

1. **Conectar (1ª vez):** no topo da página vai aparecer um aviso amarelo com o
   botão **“Conectar ao Mercado Livre”**. Clique, faça login na sua conta e
   autorize. O banner fica verde: ✅ *Conectado ao Mercado Livre*.
   (O token fica salvo e renova sozinho — normalmente você só faz isso uma vez.)
2. **Pesquisar:** no campo **“Título / palavra-chave”**, digite o que quer
   analisar (ex.: `fone bluetooth`, `air fryer`, `cadeira gamer`) e aperte
   **Enter** ou clique em **🔎 Analisar mercado**.
   - Opcional: filtre por **condição** (novo/usado), escolha a **categoria**,
     a **quantidade de anúncios** (50 a 1000) e a **ordenação**.
3. **Ler os resultados:**
   - Cards com **preço médio, mediano, mínimo, máximo, vendas somadas e
     receita estimada**.
   - Tabela com cada anúncio: **título, preço, quantidade vendida, receita
     estimada, condição, frete grátis e vendedor**.
   - Abaixo da tabela aparece a **fonte dos dados** e avisos, se houver.
4. **Baixar a planilha:** clique em **⬇️ Baixar planilha (.xlsx)**. Ela tem 4
   abas: Resumo, Anúncios (1 linha por anúncio), Vendedores e Faixas de preço.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Aviso amarelo "Credenciais não configuradas" | O `.env` não foi criado/preenchido. Refaça a Parte 1, passo 3, e reinicie o servidor. |
| Erro ao clicar em "Conectar" | O URI de redirect `http://localhost:3000/auth/callback` não está cadastrado na aplicação (DevCenter). |
| Resultado sem nº de vendas | Você não está conectado (banner amarelo) — clique em "Conectar ao Mercado Livre". |
| "Bloqueado pelo ML (anti-bot)" | Espere alguns minutos e tente de novo com menos anúncios (ex.: 50). Rodar da sua própria máquina ajuda. |
| Quer ver o que sua aplicação consegue acessar | Abra <http://localhost:3000/insights/debug?q=fone%20bluetooth> e veja o status de cada endpoint. |
