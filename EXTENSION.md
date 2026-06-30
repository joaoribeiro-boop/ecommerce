# Extensão do Chrome — instalar e usar (sem Terminal)

Esta é a forma recomendada: a extensão roda **dentro do seu Chrome**, lê os dados
do Mercado Livre pela **sua própria conexão** (então o ML não bloqueia como faz
com servidores) e gera a planilha **.xlsx**. **Não precisa de Terminal, servidor,
conta nem token.**

## Instalar (uma vez, ~4 cliques)

### 1. Baixar os arquivos do projeto
1. Acesse o repositório no GitHub:
   <https://github.com/joaoribeiro-boop/ecommerce>
2. Clique no botão verde **`< > Code`** → **Download ZIP**.
3. Na pasta de Downloads, **descompacte** o arquivo (duplo-clique no `.zip`).
   Vai virar uma pasta tipo `ecommerce-claude-...`. Dentro dela há a pasta
   **`extension`** — é essa que vamos usar.

### 2. Carregar no Chrome
1. Abra o Chrome e vá em **`chrome://extensions`** (digite na barra de endereço).
2. No canto superior direito, ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** (Load unpacked).
4. Selecione a pasta **`extension`** (de dentro do projeto descompactado).

Pronto — vai aparecer **“Análise de Mercado”** na lista.

### 3. (opcional) Fixar o ícone
Clique no ícone de peça de quebra-cabeça (extensões) na barra do Chrome e clique
no alfinete ao lado de **Análise de Mercado** para fixar.

## Usar

1. Clique no ícone da extensão → abre a interface em uma aba.
2. Escolha a **categoria** e **digite uma palavra-chave** (ex.: `fone bluetooth`).
3. Clique em **🔎 Analisar mercado** (leva alguns segundos; lê várias páginas com
   pausa).
4. Clique em **⬇️ Baixar planilha (.xlsx)**.

> Dica: antes do primeiro uso, abra **mercadolivre.com.br** normalmente uma vez
> (se aparecer alguma verificação, resolva). Isso deixa sua navegação “limpa”.

## Compartilhar com o time

Cada pessoa repete o **Instalar** (baixar ZIP + carregar a pasta `extension`).
Como roda no navegador de cada um, todos usam a própria conexão.

## Atualizar depois

Baixe o ZIP novo, substitua a pasta e, em `chrome://extensions`, clique no
**↻ (recarregar)** no card da extensão.

## Limites

- Vêm título, preço, frete grátis, link e (quando disponível) vendedor. Campos
  como quantidade vendida e condição não aparecem na listagem pública.
- Se o ML mostrar verificação anti-bot, navegue pelo site uma vez para “destravar”
  e reduza a quantidade de anúncios.
- Hoje cobre o site do Brasil (mercadolivre.com.br).
