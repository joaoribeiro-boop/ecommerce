/* =====================================================================
 * app-credentials.example.js — MODELO de credenciais embutidas
 * ---------------------------------------------------------------------
 * Para gerar o app desktop distribuível:
 *   1. Copie este arquivo para "app-credentials.js"
 *   2. Preencha com as credenciais da aplicação do Mercado Livre
 *   3. Defina uma senha de acesso (APP_PASSWORD)
 *   4. Rode o build (npm run dist)
 *
 * IMPORTANTE: app-credentials.js NÃO vai para o git (está no .gitignore).
 * Ele fica embutido no .app gerado — use apenas para distribuição interna,
 * para um time confiável.
 * ===================================================================== */

module.exports = {
  ML_CLIENT_ID: "seu_client_id",
  ML_CLIENT_SECRET: "seu_client_secret",

  // Deve ser EXATAMENTE o URI de redirect cadastrado na aplicação do ML:
  ML_REDIRECT_URI: "http://localhost:3000/auth/callback",

  // Domínio de autorização conforme o país (Brasil é o padrão):
  //   auth.mercadolivre.com.br | auth.mercadolibre.com.ar | auth.mercadolibre.com.mx
  ML_AUTH_DOMAIN: "auth.mercadolivre.com.br",

  // Senha que o time digita ao abrir o app. Deixe "" para não exigir senha.
  APP_PASSWORD: "defina-uma-senha",
};
