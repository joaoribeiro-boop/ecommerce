# App desktop (macOS) — gerar e distribuir

Este guia mostra como **transformar o projeto num aplicativo `.app`/`.dmg`** para
o time baixar e usar no Mac. Você faz o build **uma vez** numa máquina Mac e
distribui o arquivo gerado.

## Visão geral

- O app empacota um servidor interno (Node) + a interface, via **Electron**.
- Ao abrir, ele sobe em `http://localhost:3000`, pede **senha** (se configurada) e
  oferece **“Conectar ao Mercado Livre”**.
- Cada pessoa conecta **uma vez** com o **login da conta do Mercado Livre da
  empresa** (a mesma para todos). Cada máquina guarda o **seu próprio token** —
  independentes entre si.
- O token é renovado automaticamente; não precisa reconectar a cada uso.

---

## Pré-requisitos (na máquina que vai gerar o app)

- macOS
- **Node.js 18+** — <https://nodejs.org> (versão LTS) ou `brew install node`
- A aplicação criada no **devcenter** do Mercado Livre
  (<https://developers.mercadolivre.com.br/devcenter>), com **Client ID** e
  **Client Secret**, e o **URI de redirect** cadastrado **exatamente** como:
  `http://localhost:3000/auth/callback`

---

## Passo 1 — Baixar o projeto

```bash
cd ~/Documents
git clone https://github.com/joaoribeiro-boop/ecommerce.git
cd ecommerce
git checkout claude/mercado-livre-analysis-agent-tkn92m
```

## Passo 2 — Configurar as credenciais embutidas

```bash
cp app-credentials.example.js app-credentials.js
open -e app-credentials.js
```

Preencha:

```js
module.exports = {
  ML_CLIENT_ID: "SEU_CLIENT_ID",
  ML_CLIENT_SECRET: "SEU_CLIENT_SECRET",
  ML_REDIRECT_URI: "http://localhost:3000/auth/callback",
  ML_AUTH_DOMAIN: "auth.mercadolivre.com.br",
  APP_PASSWORD: "uma-senha-para-o-time",   // deixe "" para não exigir senha
};
```

> `app-credentials.js` **não vai para o git** (está no `.gitignore`). Ele é
> embutido no `.app` gerado.

## Passo 3 — Instalar dependências e gerar o app

```bash
npm install
npm run dist
```

O resultado fica em **`dist/`**:
- `Análise de Mercado-1.0.0.dmg` — instalador para distribuir
- `Análise de Mercado-1.0.0-mac.zip` — alternativa compactada

> Antes de gerar o `.dmg`, dá para testar localmente sem empacotar:
> ```bash
> npm run electron
> ```

## Passo 4 — Distribuir

Envie o arquivo **`.dmg`** para o time (Drive, Slack, etc.). Cada pessoa:

1. Abre o `.dmg` e arrasta **Análise de Mercado** para **Aplicativos**.
2. Abre o app. Como ele **não é assinado**, o macOS bloqueia na 1ª vez:
   **clique com o botão direito no app → Abrir → Abrir**. (Só na primeira vez.)
3. Digita a **senha** (se você configurou `APP_PASSWORD`).
4. Clica em **“Conectar ao Mercado Livre”** e entra com o **login da conta do ML
   da empresa**. Pronto — token salvo e renovado automaticamente.
5. Escolhe a categoria → **Analisar mercado** → **Baixar planilha (.xlsx)**.

---

## Atualizar o app depois

Quando houver mudanças no código:

```bash
git pull
npm install        # se mudaram dependências
npm run dist
```

Distribua o novo `.dmg`. (Os tokens dos usuários continuam salvos; não precisam
reconectar.)

---

## Observações e limites

- **Porta 3000**: precisa estar livre e bater com o redirect do ML. Se algum
  outro programa usar a 3000, o app avisa ao abrir.
- **Segurança**: o `Client Secret` fica dentro do `.app`. É aceitável para uso
  **interno**; não publique o app para fora da empresa.
- **Assinatura/notarização**: o app não é assinado. Para remover o aviso do
  Gatekeeper de vez, é preciso uma conta Apple Developer e configurar
  assinatura/notarização no `electron-builder` (não incluído aqui).
- **Onde ficam os tokens**: em
  `~/Library/Application Support/Análise de Mercado/tokens.json` (por máquina).
- **Windows/Linux**: o projeto roda nessas plataformas via `node server.js`; para
  gerar instaladores deles, ajuste os `target` em `package.json > build`.
