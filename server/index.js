// Servidor do Fluxo Diário: serve o frontend (public/) e a API de dados/anexos.
"use strict";

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const compression = require("compression");
const { Store, erro } = require("./store");

const PORTA = parseInt(process.env.PORT || process.env.PORTA || "3000", 10);
const PASTA_DADOS = path.resolve(process.env.PASTA_DADOS || path.join(__dirname, "..", "data"));
const PASTA_ANEXOS = path.join(PASTA_DADOS, "anexos");
const USUARIO = process.env.APP_USUARIO || "";
const SENHA = process.env.APP_SENHA || "";
const PRODUCAO = process.env.NODE_ENV === "production";

if (PRODUCAO && !SENHA && process.env.PERMITIR_SEM_SENHA !== "1") {
  console.error(
    "\n[ERRO] Em produção defina APP_USUARIO e APP_SENHA (senha de acesso ao sistema inteiro).\n" +
    "Sem isso, qualquer pessoa com o endereço consegue ler e alterar todos os dados.\n" +
    "Se tiver outra proteção na frente (VPN, Cloudflare Access...), use PERMITIR_SEM_SENHA=1.\n"
  );
  process.exit(1);
}

fs.mkdirSync(PASTA_ANEXOS, { recursive: true });
const store = new Store(PASTA_DADOS);
console.log(`[dados] ${store.total()} documentos carregados de ${PASTA_DADOS}`);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(compression());

// ---- Proteção de acesso (HTTP Basic). Fica na frente de tudo, inclusive do frontend. ----
function iguais(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
if (SENHA) {
  app.use((req, res, next) => {
    if (req.path === "/api/saude") return next();
    const h = req.headers.authorization || "";
    if (h.startsWith("Basic ")) {
      const [u, ...resto] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
      const s = resto.join(":");
      if (iguais(u, USUARIO) && iguais(s, SENHA)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Fluxo Diario", charset="UTF-8"');
    res.status(401).send("Acesso restrito.");
  });
}

app.get("/api/saude", (req, res) => res.json({ ok: true, documentos: store.total() }));

// ---- Banco de documentos ----
const api = express.Router();
api.use(express.json({ limit: "25mb" }));

api.post("/doc/ler", (req, res, next) => {
  try {
    const dados = store.get(req.body.caminho);
    res.json({ existe: dados !== null, dados });
  } catch (e) { next(e); }
});

api.post("/doc/gravar", (req, res, next) => {
  try { store.set(req.body.caminho, req.body.dados, !!req.body.merge); res.json({ ok: true }); }
  catch (e) { next(e); }
});

api.post("/doc/atualizar", (req, res, next) => {
  try { store.update(req.body.caminho, req.body.dados || {}); res.json({ ok: true }); }
  catch (e) { next(e); }
});

api.post("/doc/apagar", (req, res, next) => {
  try { store.delete(req.body.caminho); res.json({ ok: true }); }
  catch (e) { next(e); }
});

api.post("/colecao/adicionar", (req, res, next) => {
  try { const id = store.add(req.body.colecao, req.body.dados); res.json({ id }); }
  catch (e) { next(e); }
});

api.post("/colecao/consultar", (req, res, next) => {
  try {
    const docs = store.query({
      colecao: req.body.colecao, where: req.body.where || [], orderBy: req.body.orderBy || null, limit: req.body.limit || 0,
    });
    res.json({ docs: docs.map((d) => ({ id: d.id, dados: d.dados })) });
  } catch (e) { next(e); }
});

api.post("/lote", (req, res, next) => {
  try { store.lote(Array.isArray(req.body.ops) ? req.body.ops : []); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// Avisos ao vivo (Server-Sent Events): o navegador recebe os caminhos alterados e
// recarrega só as consultas afetadas.
api.get("/eventos", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  let fila = [], timer = null;
  const enviar = () => { timer = null; if (!fila.length) return; res.write("data: " + JSON.stringify({ caminhos: fila }) + "\n\n"); fila = []; };
  const aoMudar = (caminho) => { fila.push(caminho); if (!timer) timer = setTimeout(enviar, 50); };
  const pulso = setInterval(() => res.write(": ping\n\n"), 25000);
  store.on("mudanca", aoMudar);
  req.on("close", () => { clearInterval(pulso); if (timer) clearTimeout(timer); store.off("mudanca", aoMudar); });
});

// ---- Anexos (comprovantes, PDFs de boletos, documentos de empresas) ----
const TIPOS_OK = /^(application\/pdf|image\/(png|jpeg|gif|webp|heic|heif|bmp|tiff)|text\/(plain|csv|xml)|application\/(xml|zip|octet-stream|vnd\.[a-z0-9.\-+]+|x-ofx|ofx))$/i;
api.post("/anexos", express.raw({ type: () => true, limit: process.env.LIMITE_ANEXO || "30mb" }), (req, res, next) => {
  try {
    const tipo = (req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
    if (!TIPOS_OK.test(tipo)) throw erro(415, "tipo de arquivo não permitido: " + tipo);
    if (!req.body || !req.body.length) throw erro(400, "arquivo vazio");
    const id = crypto.randomBytes(16).toString("hex");
    let nome = "arquivo";
    try { nome = decodeURIComponent(req.headers["x-nome-arquivo"] || "arquivo"); } catch (e) {}
    fs.writeFileSync(path.join(PASTA_ANEXOS, id), req.body);
    const meta = { id, contentType: tipo, sizeBytes: req.body.length, nome, enviadoEm: new Date().toISOString() };
    fs.writeFileSync(path.join(PASTA_ANEXOS, id + ".json"), JSON.stringify(meta));
    res.json({ id, url: "/_blob/" + id, contentType: tipo, sizeBytes: req.body.length });
  } catch (e) { next(e); }
});

api.delete("/anexos/:id", (req, res, next) => {
  try {
    if (!/^[0-9a-f]{32}$/.test(req.params.id)) throw erro(400, "id inválido");
    for (const f of [req.params.id, req.params.id + ".json"]) {
      const p = path.join(PASTA_ANEXOS, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use("/api", api);

app.get("/_blob/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).end();
  const arq = path.join(PASTA_ANEXOS, id);
  if (!fs.existsSync(arq)) return res.status(404).send("Anexo não encontrado.");
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(arq + ".json", "utf8")); } catch (e) {}
  res.set("Content-Type", meta.contentType || "application/octet-stream");
  res.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(meta.nome || id));
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(arq);
});

// ---- Frontend ----
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: PRODUCAO ? "1h" : 0 }));

// ---- Erros ----
app.use((err, req, res, next) => {
  const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ erro: err.message || "erro interno" });
});

const servidor = app.listen(PORTA, () => {
  console.log(`[ok] Fluxo Diário rodando em http://localhost:${PORTA}` + (SENHA ? " (protegido por senha)" : " (SEM senha de acesso)"));
});

function encerrar() {
  servidor.close(() => { store.fechar(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
