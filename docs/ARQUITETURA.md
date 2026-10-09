# Arquitetura

```
navegador ─── public/index.html + styles.css
          ├── public/claude-shim.js   → window.claude.use("db" | "assets" | "downloads")
          ├── public/vendor/xlsx.full.min.js (SheetJS: ler/gerar Excel)
          └── public/app.js           → toda a lógica (abas, regras contábeis, relatórios)
                    │  fetch /api/...   + EventSource /api/eventos (avisos ao vivo)
servidor ─── server/index.js  (Express: senha de acesso, API, anexos, arquivos estáticos)
          └── server/store.js (documentos JSON numa tabela SQLite + cópia em memória)
dados    ─── data/fluxo.db    (banco)   data/anexos/<id> + <id>.json (arquivos e metadados)
```

O app nasceu como um "artifact" do Claude, que oferecia um banco de documentos no estilo Firestore. O `claude-shim.js` reproduz exatamente essa interface sobre o backend próprio; por isso o `app.js` não precisou mudar.

## API do backend

Todas as rotas recebem/devolvem JSON e ficam atrás da senha de acesso (HTTP Basic), exceto `/api/saude`.

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/doc/ler` | `{caminho}` | `{existe, dados}` |
| `POST /api/doc/gravar` | `{caminho, dados, merge}` | `{ok}` |
| `POST /api/doc/atualizar` | `{caminho, dados}` (mescla raso; 404 se não existir) | `{ok}` |
| `POST /api/doc/apagar` | `{caminho}` | `{ok}` |
| `POST /api/colecao/adicionar` | `{colecao, dados}` | `{id}` |
| `POST /api/colecao/consultar` | `{colecao, where:[[campo, op, valor]], orderBy:[campo, "asc"/"desc"], limit}` | `{docs:[{id, dados}]}` |
| `POST /api/lote` | `{ops:[{tipo:"set"/"update"/"delete", caminho, dados, merge}]}` | `{ok}` |
| `GET /api/eventos` | — | stream SSE: `data: {"caminhos":[...]}` a cada alteração |
| `POST /api/anexos` | corpo = arquivo; cabeçalhos `Content-Type` e `X-Nome-Arquivo` | `{id, url, contentType, sizeBytes}` |
| `DELETE /api/anexos/:id` | — | `{ok}` |
| `GET /_blob/:id` | — | o arquivo |
| `GET /api/saude` | — | `{ok, documentos}` |

Operadores de `where`: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`. Como no Firestore, um campo ausente nunca passa em `!=`/`>`/`<`.

## Coleções

| Coleção | Qtde (09/10/2026) | Conteúdo |
|---|---|---|
| `lancamentos` | 93 | Todo lançamento: `tipo` (despesa, receita, compra, venda, transferencia, lancamento_contabil, adiantamento_cliente/fornecedor, devolucao, receita/despesa_financeira, deposito_nao_identificado), `empresa`, `data`, `valor`, `historico`, `fornecedor` (nome do cliente/fornecedor), `despesa` (item de Pagamento/Recebimento), `centroCusto`, `banco`, `formaPagamento`, `contaDebito`/`contaCredito` (ids do plano de contas), `competencia` + `parcelas[]` (títulos: `vencimento`, `valor`, `valorPago`, `paga`, `cobranca{status,data,por}`), `baixas[]` (títulos baixados por um pagamento/recebimento), `rateios[]`, `comprovantes[]` (ids de anexos), `chaveNFe`, `ofxId`, `recorrenciaId`, `createdAt` |
| `clientesCadastro` / `fornecedoresCadastro` | 9.346 / 845 | Cadastro: `nome`, `documento`, endereço, `contaContabilId`/`contaCodigo` (conta própria 1.1.2.01.x / 2.1.3.01.x), `limiteCredito`, `saldoInicial` = `{EMPRESA: [{valor, vencimento, documento, valorPago, paga, cobranca}]}` (boletos anteriores ao sistema) |
| `indiceParticipantes` | 64 | Índice de busca rápida por inicial (`clientes_a`, `fornecedores_b`…): `itens = [[id, nome, cpfcnpj, contaId, contaCodigo]]` |
| `listaConfig` | 15 | Configurações: `planoContas` (`contas[]` com id, codigo, nome, tipo sintetica/analitica, natureza, grupo, refRFB), `regrasContabeis`, `contasBancos`, `contasDespesas`, `extras` (listas de bancos, centros, formas…), `bloqueios` (por área), `planoVisibilidade` (contas/referencial bloqueados ou ocultos), `formasParceladas`, `nfeConfig`, `ofxRegras`, `removidos`, `renomeadosBase`, `indiceEstado` |
| `usuarios` | 3 | `usuario`, `senha` (**texto puro — ver AGENTS.md**), `papel` (admin/supervisor/colaborador), `areas`, `empresas`, `todasEmpresas`, `recoveryKey`, `locked`, `failedAttempts` |
| `saldosIniciais` | 8 | Saldo inicial de cada banco por empresa (`empresa__banco`) |
| `fechamentosDiarios` / `fechamentosMensais` | 270 / 0 | Dias/meses fechados por empresa |
| `empresasCadastro` | 1 | Dados cadastrais das empresas, sócios e documentos anexados |
| `recorrencias` | 0 | Lançamentos recorrentes sem fim (modelo + periodicidade + `proximoIdx`) |

## Regras de negócio importantes (onde ficam no app.js)

- **Contabilização automática**: `calcularContabilAuto`, `resolverContabilParaSalvar`, `regraContabilDoTipo`.
- **Títulos a pagar/receber**: `listarTitulos` (lançamentos por competência + saldos iniciais), `aplicarBaixas`, `atualizarPainelTitulos`.
- **Sócios → dividendos a pagar (2.1.7.x)**: `contaSocioDoNome`.
- **Adiantamentos com conta por cliente/fornecedor**: `garantirContaAdiantamento`, `contaAdiantamentoDe`.
- **Recorrências**: `gerarRecorrenciasPendentes` (cria o lançamento do período com id fixo `rec_<id>_<n>`).
- **Inadimplência/limite**: `mapaInadimplencia`, `marcarCobranca`, `atualizarStatusParticipante`, `renderInadimplencia`.
- **Relatórios**: `renderRazao`, `renderPosicao`, `renderBalancete`, `renderBalanco`, `renderGraficos`.
- **Importações**: NF-e/NFS-e (`importarNFes`), OFX (procure por `ofx`), planilha (`processarLinhaImport`).
