// Banco de documentos (estilo Firestore) sobre SQLite.
//
// O frontend foi escrito para uma API de documentos: coleções com documentos JSON,
// consultas com where/orderBy/limit e assinaturas ao vivo (onSnapshot). Este módulo guarda
// tudo numa tabela SQLite (um documento JSON por linha) e mantém uma cópia em memória para
// as consultas serem rápidas. Com ~10 mil documentos isso usa poucas dezenas de MB de RAM.
//
// Caminho de um documento: "<colecao>/<id>" (ou subcoleções: "a/b/c/d").
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const SEGMENTO_OK = /^[A-Za-z0-9_\-.~:@+ ]{1,300}$/;

function validarCaminho(p, esperaDocumento) {
  if (typeof p !== "string" || !p) throw erro(400, "caminho vazio");
  const partes = p.split("/");
  for (const s of partes) {
    if (!SEGMENTO_OK.test(s) || s === "." || s === "..") throw erro(400, "caminho inválido: " + p);
  }
  const ehDoc = partes.length % 2 === 0;
  if (esperaDocumento && !ehDoc) throw erro(400, "esperado caminho de documento (colecao/id): " + p);
  if (!esperaDocumento && ehDoc) throw erro(400, "esperado caminho de coleção: " + p);
  return partes;
}

function erro(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function colecaoDe(caminhoDoc) {
  const i = caminhoDoc.lastIndexOf("/");
  return caminhoDoc.slice(0, i);
}
function idDe(caminhoDoc) {
  return caminhoDoc.slice(caminhoDoc.lastIndexOf("/") + 1);
}

function novoId() {
  // 20 caracteres [a-z0-9], como os ids gerados pela plataforma original
  const alfabeto = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(20);
  let s = "";
  for (let i = 0; i < 20; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return s;
}

function valorCampo(obj, campo) {
  return campo.split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

// Comparação usada em where/orderBy: números com números, textos com textos.
function comparar(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function passaFiltro(dados, [campo, op, valor]) {
  const v = valorCampo(dados, campo);
  switch (op) {
    case "==": return v === valor || (v === undefined && valor === null);
    case "!=": return v !== undefined && v !== valor; // como no Firestore: campo ausente nunca passa
    case ">": return v !== undefined && v !== null && comparar(v, valor) > 0;
    case ">=": return v !== undefined && v !== null && comparar(v, valor) >= 0;
    case "<": return v !== undefined && v !== null && comparar(v, valor) < 0;
    case "<=": return v !== undefined && v !== null && comparar(v, valor) <= 0;
    case "in": return Array.isArray(valor) && valor.includes(v);
    case "not-in": return Array.isArray(valor) && v !== undefined && !valor.includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(valor);
    default: throw erro(400, "operador não suportado: " + op);
  }
}

class Store extends EventEmitter {
  constructor(pastaDados) {
    super();
    this.setMaxListeners(0);
    fs.mkdirSync(pastaDados, { recursive: true });
    this.arquivoDados = path.join(pastaDados, "fluxo.json");
    
    // cache: colecao -> Map(id -> objeto)
    this.cache = new Map();
    
    if (fs.existsSync(this.arquivoDados)) {
      try {
        const dados = JSON.parse(fs.readFileSync(this.arquivoDados, "utf8"));
        for (const [caminho, doc] of Object.entries(dados)) {
          this._colecao(colecaoDe(caminho)).set(idDe(caminho), doc);
        }
      } catch(e) {
        console.error("Erro ao ler JSON local", e);
      }
    }
  }

  _salvar() {
    clearTimeout(this._timerSave);
    this._timerSave = setTimeout(() => {
      fs.writeFileSync(this.arquivoDados, JSON.stringify(this.exportarTudo(), null, 2));
    }, 50);
  }

  _colecao(nome) {
    let m = this.cache.get(nome);
    if (!m) { m = new Map(); this.cache.set(nome, m); }
    return m;
  }

  total() {
    let n = 0;
    for (const m of this.cache.values()) n += m.size;
    return n;
  }

  get(caminho) {
    validarCaminho(caminho, true);
    const m = this.cache.get(colecaoDe(caminho));
    const d = m && m.get(idDe(caminho));
    return d === undefined ? null : d;
  }

  _gravar(caminho, dados) {
    const col = colecaoDe(caminho);
    this._colecao(col).set(idDe(caminho), dados);
    this._salvar();
  }

  set(caminho, dados, merge) {
    validarCaminho(caminho, true);
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw erro(400, "o documento precisa ser um objeto");
    const atual = this.get(caminho);
    const novo = merge && atual ? Object.assign({}, atual, dados) : dados;
    this._gravar(caminho, novo);
    this.emit("mudanca", caminho);
  }

  update(caminho, dados) {
    validarCaminho(caminho, true);
    const atual = this.get(caminho);
    if (atual === null) throw erro(404, "documento não existe: " + caminho);
    this._gravar(caminho, Object.assign({}, atual, dados));
    this.emit("mudanca", caminho);
  }

  delete(caminho) {
    validarCaminho(caminho, true);
    const col = colecaoDe(caminho);
    const m = this.cache.get(col);
    if (m) m.delete(idDe(caminho));
    this._salvar();
    this.emit("mudanca", caminho);
  }

  add(colecao, dados) {
    validarCaminho(colecao, false);
    let id;
    do { id = novoId(); } while (this.get(colecao + "/" + id) !== null);
    this.set(colecao + "/" + id, dados, false);
    return id;
  }

  // q = { colecao, where: [[campo, op, valor]...], orderBy: [campo, "asc"|"desc"] | null, limit }
  query(q) {
    validarCaminho(q.colecao, false);
    const m = this.cache.get(q.colecao);
    if (!m) return [];
    let lista = [];
    for (const [id, dados] of m) {
      if ((q.where || []).every((w) => passaFiltro(dados, w))) lista.push({ id, dados });
    }
    if (q.orderBy && q.orderBy[0]) {
      const campo = q.orderBy[0], dir = q.orderBy[1] === "desc" ? -1 : 1;
      lista.sort((a, b) => comparar(valorCampo(a.dados, campo), valorCampo(b.dados, campo)) * dir || (a.id < b.id ? -1 : 1));
    }
    const lim = Math.max(0, Math.min(10000, parseInt(q.limit, 10) || 0));
    if (lim) lista = lista.slice(0, lim);
    return lista;
  }

  // Aplica várias escritas numa transação só.
  lote(ops) {
    const caminhos = [];
    for (const op of ops) {
      if (op.tipo === "set") { this.set(op.caminho, op.dados, !!op.merge); }
      else if (op.tipo === "update") { this.update(op.caminho, op.dados); }
      else if (op.tipo === "delete") { this.delete(op.caminho); }
      else throw erro(400, "operação desconhecida: " + op.tipo);
      caminhos.push(op.caminho);
    }
    this._salvar();
    return caminhos;
  }

  // Exporta tudo: { "colecao/id": dados }
  exportarTudo() {
    const out = {};
    for (const [col, m] of this.cache) for (const [id, d] of m) out[col + "/" + id] = d;
    return out;
  }

  fechar() { }
}

module.exports = { Store, erro, validarCaminho, colecaoDe, idDe };
