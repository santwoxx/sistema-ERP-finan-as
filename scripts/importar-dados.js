// Importa os dados exportados (pasta dados-iniciais/) para o banco local (data/fluxo.db).
//
//   npm run importar            -> só importa se o banco estiver vazio
//   npm run importar -- --forcar -> grava por cima do que já existir com o mesmo caminho
//
// Formato esperado: dados-iniciais/<colecao>/<id>.json (um documento por arquivo) e
// dados-iniciais/anexos/<id>.<ext> (PDFs/imagens; o id de 32 caracteres é o mesmo
// referenciado nos lançamentos).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Store } = require("../server/store");

const ORIGEM = path.resolve(process.argv.find((a) => a.startsWith("--origem="))?.slice(9) || path.join(__dirname, "..", "dados-iniciais"));
const PASTA_DADOS = path.resolve(process.env.PASTA_DADOS || path.join(__dirname, "..", "data"));
const FORCAR = process.argv.includes("--forcar");

const store = new Store(PASTA_DADOS);
if (store.total() > 0 && !FORCAR) {
  console.log(`O banco já tem ${store.total()} documentos. Nada foi importado.\nUse "npm run importar -- --forcar" para gravar por cima.`);
  process.exit(0);
}

const TIPOS = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", xml: "application/xml", txt: "text/plain", csv: "text/csv" };
let nDocs = 0, nAnexos = 0;

const ops = [];
for (const col of fs.readdirSync(ORIGEM)) {
  const dir = path.join(ORIGEM, col);
  if (!fs.statSync(dir).isDirectory() || col === "anexos") continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const dados = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    ops.push({ tipo: "set", caminho: col + "/" + f.slice(0, -5), dados });
  }
}
for (let i = 0; i < ops.length; i += 1000) { store.lote(ops.slice(i, i + 1000)); }
nDocs = ops.length;

const dirAnexos = path.join(ORIGEM, "anexos");
const destino = path.join(PASTA_DADOS, "anexos");
fs.mkdirSync(destino, { recursive: true });
if (fs.existsSync(dirAnexos)) {
  for (const f of fs.readdirSync(dirAnexos)) {
    const m = f.match(/^([0-9a-f]{32})(?:\.(\w+))?$/);
    if (!m) continue;
    fs.copyFileSync(path.join(dirAnexos, f), path.join(destino, m[1]));
    const tamanho = fs.statSync(path.join(destino, m[1])).size;
    fs.writeFileSync(path.join(destino, m[1] + ".json"), JSON.stringify({
      id: m[1], contentType: TIPOS[(m[2] || "").toLowerCase()] || "application/octet-stream", sizeBytes: tamanho, nome: f, enviadoEm: new Date().toISOString(),
    }));
    nAnexos++;
  }
}
store.fechar();
console.log(`[ok] ${nDocs} documentos e ${nAnexos} anexos importados para ${PASTA_DADOS}`);
