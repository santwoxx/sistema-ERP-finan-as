// Gera um backup completo (documentos + anexos) no mesmo formato de dados-iniciais/,
// que pode ser reimportado com "npm run importar -- --origem=backups/<pasta> --forcar".
//
//   npm run backup
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Store } = require("../server/store");

const PASTA_DADOS = path.resolve(process.env.PASTA_DADOS || path.join(__dirname, "..", "data"));
const carimbo = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const DESTINO = path.resolve(process.env.PASTA_BACKUPS || path.join(__dirname, "..", "backups"), "backup-" + carimbo);

const store = new Store(PASTA_DADOS);
const tudo = store.exportarTudo();
let n = 0;
for (const [caminho, dados] of Object.entries(tudo)) {
  const i = caminho.lastIndexOf("/");
  const dir = path.join(DESTINO, caminho.slice(0, i));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, caminho.slice(i + 1) + ".json"), JSON.stringify(dados, null, 2));
  n++;
}
const origemAnexos = path.join(PASTA_DADOS, "anexos");
const destAnexos = path.join(DESTINO, "anexos");
fs.mkdirSync(destAnexos, { recursive: true });
let a = 0;
if (fs.existsSync(origemAnexos)) {
  for (const f of fs.readdirSync(origemAnexos)) {
    if (!/^[0-9a-f]{32}$/.test(f)) continue;
    let ext = "";
    try { const meta = JSON.parse(fs.readFileSync(path.join(origemAnexos, f + ".json"), "utf8")); ext = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" }[meta.contentType] || ""; } catch (e) {}
    fs.copyFileSync(path.join(origemAnexos, f), path.join(destAnexos, f + ext));
    a++;
  }
}
store.fechar();
console.log(`[ok] Backup com ${n} documentos e ${a} anexos em ${DESTINO}`);
