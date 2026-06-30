/* =====================================================================
 * electron/main.js — Processo principal do app desktop (macOS)
 * ---------------------------------------------------------------------
 * Sobe o servidor interno (server.js) em localhost e abre uma janela
 * nativa apontando para ele. Os tokens ficam na pasta de dados do app
 * (gravável); as credenciais vêm de app-credentials.js (embutido).
 * ===================================================================== */

"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");

// Porta fixa: precisa bater com o "URI de redirect" cadastrado no ML
// (http://localhost:3000/auth/callback). localhost é liberado sem https.
const PORT = 3000;

// Tokens em local gravável (dentro do .app os arquivos são somente leitura).
process.env.DATA_DIR = app.getPath("userData");
// Arquivos estáticos (index.html/assets) ficam junto do server.js.
process.env.STATIC_DIR = path.join(__dirname, "..");

const { startServer } = require("../server.js");

let win;

function createWindow(url) {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: "Análise de Mercado",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);

  // Links externos (ex.: permalink de anúncio) abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("http://localhost:" + PORT)) return { action: "allow" };
    shell.openExternal(target);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    const { url } = await startServer({ port: PORT, quiet: true });
    createWindow(url);
  } catch (e) {
    const busy = e && e.code === "EADDRINUSE";
    dialog.showErrorBox(
      "Não foi possível iniciar",
      busy
        ? `A porta ${PORT} já está em uso. Feche o outro programa que a utiliza e abra o app de novo.`
        : "Erro ao iniciar o servidor interno:\n" + (e && e.message ? e.message : String(e))
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && win == null) {
      createWindow(`http://localhost:${PORT}`);
    }
  });
});

app.on("window-all-closed", () => {
  app.quit(); // inclusive no macOS: fechar a janela encerra o servidor
});
