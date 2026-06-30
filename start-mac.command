#!/bin/bash
# Lançador para macOS — duplo-clique para iniciar o app.
# Abre o navegador e sobe o servidor local.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado."
  echo "   Instale em https://nodejs.org (versão LTS) ou rode: brew install node"
  echo ""
  read -r -p "Pressione Enter para fechar."
  exit 1
fi

if [ ! -f .env ]; then
  echo "⚠️  Arquivo .env não encontrado."
  echo "   Copie o modelo:  cp .env.example .env"
  echo "   e preencha ML_CLIENT_ID e ML_CLIENT_SECRET."
  echo ""
fi

PORT="${PORT:-3000}"
# Abre o navegador depois de 2s (tempo do servidor subir).
( sleep 2; open "http://localhost:${PORT}" ) &

echo "Iniciando… (feche esta janela para parar o servidor)"
exec node server.js
