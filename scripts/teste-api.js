// Teste rápido do banco de documentos (sem navegador): npm run teste
"use strict";
const os = require("os");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { Store } = require("../server/store");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluxo-teste-"));
const s = new Store(dir);
s.set("clientesCadastro/a", { nome: "ANA", saldoInicial: { CENTRAL: [] } });
s.set("clientesCadastro/b", { nome: "BRUNO", saldoInicial: null });
s.set("clientesCadastro/c", { nome: "CARLA" });
assert.strictEqual(s.query({ colecao: "clientesCadastro", where: [["saldoInicial", "!=", null]] }).length, 1);
assert.deepStrictEqual(s.query({ colecao: "clientesCadastro", orderBy: ["nome"], where: [["nome", ">", "ANA"]] }).map((d) => d.id), ["b", "c"]);
s.update("clientesCadastro/a", { limiteCredito: 1000 });
assert.strictEqual(s.get("clientesCadastro/a").limiteCredito, 1000);
assert.throws(() => s.update("clientesCadastro/zzz", { x: 1 }));
const id = s.add("lancamentos", { valor: 10, createdAt: "2026-01-01T00:00:00Z" });
assert.strictEqual(s.get("lancamentos/" + id).valor, 10);
s.delete("lancamentos/" + id);
assert.strictEqual(s.get("lancamentos/" + id), null);
s.fechar();
const s2 = new Store(dir); // reabre: persistiu?
assert.strictEqual(s2.total(), 3);
s2.fechar();
fs.rmSync(dir, { recursive: true, force: true });
console.log("[ok] banco de documentos funcionando");
