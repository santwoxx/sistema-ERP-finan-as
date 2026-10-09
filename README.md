# Fluxo Diário

Sistema financeiro e contábil das empresas CENTRAL, ITABUNA, IVONE, MÓVEIS e SAJ: lançamentos do dia a dia, títulos a pagar e a receber, importação de NF-e/NFS-e e de extrato OFX, balancete, balanço e DRE, gráficos, inadimplência e lançamentos recorrentes.

Este pacote traz o sistema completo para rodar fora do Claude:

- **frontend**: em `public/`, a mesma tela de hoje;
- **backend**: em `server/`, Node.js com Express e banco SQLite;
- **dados atuais**: em `dados-iniciais/`, exportados em 09/10/2026.

---

## 1. Rodar no seu computador

Precisa do **Node.js 20 ou mais novo** (https://nodejs.org).

```bash
npm install              # instala as dependências
cp .env.example .env     # configurações (no Windows: copy .env.example .env)
npm run importar         # carrega os dados de dados-iniciais/ para data/fluxo.db
npm start                # inicia em http://localhost:3000
```

Ao abrir o endereço:

1. O navegador pede o usuário e a senha de acesso. São os valores de `APP_USUARIO` e `APP_SENHA` no `.env`.
2. Depois aparece o login do próprio sistema. Os usuários de sempre continuam valendo: **administrador**, **bela** e **wallace**.

Para desenvolver com reinício automático a cada alteração no servidor, use `npm run dev`.

## 2. Abrir no Antigravity

1. Descompacte a pasta e abra-a no Antigravity (File → Open Folder).
2. Peça ao agente para ler o **`AGENTS.md`**. Ele explica a arquitetura, onde fica cada coisa e o que não pode ser quebrado.
3. No terminal integrado, rode os comandos da seção 1.

| Arquivo | O que é |
|---|---|
| `public/app.js` | Toda a lógica da tela (cerca de 11 mil linhas, JavaScript puro, sem build) |
| `public/index.html` | A estrutura da página (abas, formulários, tabelas) |
| `public/styles.css` | O visual |
| `public/claude-shim.js` | Ponte entre o app e o backend. Mantém a mesma interface do Claude |
| `server/index.js` | API, anexos, senha de acesso e avisos ao vivo |
| `server/store.js` | Banco de documentos sobre SQLite |
| `docs/ARQUITETURA.md` | Coleções do banco e formato de cada documento |

## 3. Colocar no ar

Qualquer serviço que rode Node.js ou Docker serve. O único requisito é ter um **disco persistente** para a pasta de dados. Sem ele, os dados se perdem a cada nova versão publicada.

### Opção A: Render, Railway ou Fly.io (mais simples)

1. Suba a pasta para um repositório **privado** no GitHub. O `.gitignore` deixa de fora `dados-iniciais/`, então inclua essa pasta manualmente só se o repositório for privado.
2. Crie o serviço a partir do repositório, usando o `Dockerfile` que já vem no pacote.
3. Crie um **disco ou volume** montado em `/app/data`.
4. Defina as variáveis:
   - `APP_USUARIO`
   - `APP_SENHA` (use uma senha forte)
   - `NODE_ENV=production`
5. Na primeira subida, o container importa `dados-iniciais/` sozinho, se o banco estiver vazio.

### Opção B: VPS própria (Hostinger, DigitalOcean, Contabo…)

```bash
docker build -t fluxo-diario .
docker run -d --name fluxo -p 3000:3000 \
  -e APP_USUARIO=fluxo -e APP_SENHA='senha-forte' \
  -v /srv/fluxo-data:/app/data --restart unless-stopped fluxo-diario
```

Coloque um proxy com HTTPS na frente (Caddy ou Nginx com Let's Encrypt). **Não use o sistema sem HTTPS na internet.**

Também dá para rodar sem Docker: `npm install --omit=dev`, depois `npm run importar` e `pm2 start server/index.js --name fluxo`.

## 4. Backup

```bash
npm run backup
```

Gera `backups/backup-AAAA-MM-DD.../` com todos os documentos e anexos, no mesmo formato de `dados-iniciais/`. Para restaurar:

```bash
npm run importar -- --origem=backups/backup-... --forcar
```

Recomendação: agendar um backup diário (cron ou o agendador do serviço) e copiar a pasta para fora do servidor.

## 5. Segurança: leia antes de publicar

- **A senha de acesso (`APP_SENHA`) é obrigatória em produção.** O servidor não sobe sem ela, porque o app lê o banco direto do navegador, inclusive os usuários.
- **As senhas dos usuários do sistema estão gravadas em texto puro** na coleção `usuarios`, herança da versão original. É o primeiro ajuste recomendado: guardar só um hash (bcrypt ou argon2) e validar o login no servidor. O `AGENTS.md` traz o passo a passo.
- **As permissões por perfil** (administrador, supervisor, áreas) são aplicadas só na tela. Quem tem a senha de acesso consegue chamar a API diretamente. Para um controle mais rígido, mova a validação para o servidor.
- **`dados-iniciais/` contém os dados reais**: clientes, CPFs e CNPJs, valores e usuários. Não publique essa pasta em repositório público e apague-a do servidor depois da primeira importação.

## 6. Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o servidor |
| `npm run dev` | Inicia e reinicia sozinho ao alterar o servidor |
| `npm run importar` | Importa `dados-iniciais/` se o banco estiver vazio (`-- --forcar` grava por cima) |
| `npm run backup` | Gera um backup completo em `backups/` |
| `npm run teste` | Teste rápido do banco de documentos |

`original/fluxo-artifact.html` é o arquivo único da versão que roda no Claude, guardado só como referência.
