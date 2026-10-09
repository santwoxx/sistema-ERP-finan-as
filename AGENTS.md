# Guia para agentes de IA (Antigravity, Gemini, Claude, Copilot…)

Leia isto antes de alterar o projeto. Detalhes de dados e API em `docs/ARQUITETURA.md`.

## O que é

Sistema financeiro/contábil em português (Brasil) para 5 empresas (CENTRAL, ITABUNA, IVONE, MÓVEIS, SAJ). Usuários: equipe financeira e contábil. Toda a interface e as mensagens são em **português**; mantenha assim.

## Como está montado

- **Frontend sem build**: `public/index.html` + `public/styles.css` + `public/app.js` (JavaScript ES5/ES2017 puro, um IIFE grande, ~11 mil linhas, sem framework). Edite direto; recarregue o navegador.
- **Ponte de dados**: `public/claude-shim.js` implementa `window.claude.use("db" | "assets" | "downloads")` — uma API estilo Firestore (`db.collection().where().orderBy().limit().onSnapshot()`, `db.doc().get/set/update/delete`). **Não mude a interface** sem mudar todos os usos em `app.js`.
- **Backend**: `server/index.js` (Express) + `server/store.js` (documentos JSON em SQLite com cópia em memória; avisos ao vivo por SSE em `/api/eventos`).
- **Dados**: `data/fluxo.db` e `data/anexos/`. Nunca versionar.

## Rodar

```bash
npm install && cp .env.example .env && npm run importar && npm run dev
# http://localhost:3000  (senha de acesso = APP_USUARIO/APP_SENHA do .env)
npm run teste   # teste do banco
```

## Convenções do app.js

- Estado global dentro do IIFE: `allDocs` (todos os lançamentos, carregados em páginas de 1000 por `createdAt`), `planoContas`, `regrasContabeis`, `clientesCadastro`/`fornecedoresCadastro` (cache parcial), `indicePart` (índice de busca), `currentUser`.
- Valores monetários: número em reais; arredondar com `r2()`; exibir com `brl()`. Datas: texto ISO `AAAA-MM-DD`; exibir com `fmtDate()`.
- Toda partida contábil tem `contaDebito` e `contaCredito` (ids do plano). Contas de cliente/fornecedor são virtuais: ids `cli_<slug>` / `forn_<slug>`, códigos `1.1.2.01.x` / `2.1.3.01.x`.
- Títulos = `parcelas[]` de lançamentos com `competencia: true` (compra, venda, lançamento contábil com fornecedor) + boletos de `saldoInicial` dos cadastros (docId sintético `si|<cat>|<slug>|<empresa>`). Baixas ficam em `baixas[]` do pagamento/recebimento.
- Novos lançamentos precisam de `createdAt` (ISO) — o carregamento pagina por esse campo.
- Toasts: `showToast(msg, erro)` no formulário; `genericToast(el, msg, erro)` nas outras telas.

## Melhorias recomendadas (em ordem)

1. **Senhas em texto puro** (`usuarios.senha`). Criar rotas `POST /api/login` e `POST /api/usuarios/senha` no servidor; guardar `senhaHash` (bcrypt/argon2); no `app.js`, trocar a comparação `data.senha !== senha` (procure por `elBtnLogin.addEventListener`) e a criação/troca de senha (aba Usuários, primeiro admin, recuperação) por chamadas a essas rotas; depois remover `senha` dos documentos e bloquear leitura de `usuarios` pela API genérica.
2. **Sessão no servidor** (cookie httpOnly) e **checagem de permissão** (papel/área/empresa) nas rotas de escrita, em vez de só na tela.
3. **Fontes locais** (hoje vêm do Google Fonts) e pdf.js local (hoje é carregado do cdnjs ao abrir PDF).
4. Se o volume crescer muito (centenas de milhares de lançamentos), filtrar por período no servidor em vez de carregar tudo no navegador.

## Cuidados

- `dados-iniciais/` tem dados reais (CPF/CNPJ, valores, usuários). Não publicar.
- Não quebrar o formato dos documentos existentes; se precisar migrar, escreva um script em `scripts/` e rode com backup (`npm run backup`) antes.
- Ao testar alterações de tela, faça um lançamento de teste e apague depois (ou use uma cópia de `data/`).
