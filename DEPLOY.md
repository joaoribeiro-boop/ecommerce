# Publicar na internet (link compartilhável, sem instalar nada)

Este guia sobe o app no **Render** (tem plano gratuito) e te dá um **link
https** que qualquer pessoa do time abre no navegador, protegido por **senha**.
Tudo por telas web — **sem Terminal**.

## Passo a passo (cliques)

1. Acesse <https://render.com> e crie uma conta (pode entrar com o GitHub).
2. No painel, clique em **New +** → **Blueprint**.
3. Conecte sua conta do **GitHub** e selecione o repositório
   **`joaoribeiro-boop/ecommerce`**.
4. Em **Branch**, escolha **`claude/mercado-livre-analysis-agent-tkn92m`**.
5. O Render vai ler o arquivo `render.yaml` automaticamente. Ele vai pedir o
   valor da variável **`APP_PASSWORD`** → digite a **senha** que o time usará
   para entrar.
6. Clique em **Apply / Create**. Espere o deploy terminar (alguns minutos).
7. O Render mostra a URL do app, algo como
   **`https://analise-mercado-ml.onrender.com`**. É esse o link para abrir e
   compartilhar.

## Como usar

1. Abra o link → digite a **senha**.
2. Escolha a categoria, **digite uma palavra-chave** e clique em **Analisar
   mercado**.
3. **Baixar planilha (.xlsx)**.

## ⚠️ Importante testar logo após subir (pode haver bloqueio)

A raspagem rodando de um servidor na nuvem **pode ser barrada** pelo anti-bot do
Mercado Livre (IPs de datacenter são mais vigiados que o IP da sua casa/empresa).

Para checar, abra (troque a palavra-chave):

```
https://SEU-LINK.onrender.com/scrape/debug?q=fone%20bluetooth
```

- Se `blocked: false` e `totalParsed` maior que 0 → **funcionando** ✅
- Se `blocked: true` ou `totalParsed: 0` → o ML barrou o servidor. Nesse caso me
  avise: dá para tentar mitigações (proxy residencial, ajustes de cabeçalho) ou
  voltar a rodar localmente.

## Observações

- **Plano grátis do Render**: o serviço "dorme" após um tempo sem uso e demora
  alguns segundos para acordar na primeira visita. Normal.
- A senha fica na variável `APP_PASSWORD` (no painel do Render), não no código.
- Para atualizar o app depois, basta enviar mudanças para a branch — o Render
  refaz o deploy sozinho.
