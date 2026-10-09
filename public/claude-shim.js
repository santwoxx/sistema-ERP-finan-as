// Camada de compatibilidade: o app.js foi escrito para a plataforma de artifacts do Claude,
// que entrega window.claude.use("db" | "assets" | "downloads"). Aqui essas três peças são
// reimplementadas sobre o backend próprio (server/index.js), com a MESMA interface:
//
//   db.collection(c).where(campo, op, valor).orderBy(campo, dir).limit(n).get() / .onSnapshot(cb, erroCb)
//   db.collection(c).add(dados) / .doc(id)
//   db.doc("col/id").get() / .set(dados, {merge}) / .update(dados) / .delete() / .onSnapshot(cb, erroCb)
//   db.batch() / db.runTransaction(fn)
//   assets.upload(File) -> {id, url, contentType, sizeBytes} / assets.delete(id)
//   downloads.save({filename, data: Blob})
//
// As assinaturas ao vivo (onSnapshot) recebem avisos do servidor por Server-Sent Events
// (/api/eventos) e refazem só as consultas afetadas.
(function () {
  "use strict";

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function colecaoDe(caminho) { return caminho.slice(0, caminho.lastIndexOf("/")); }
  function idDe(caminho) { return caminho.slice(caminho.lastIndexOf("/") + 1); }

  async function chamar(rota, corpo) {
    const r = await fetch("/api" + rota, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo || {}),
      credentials: "same-origin",
    });
    let json = null;
    try { json = await r.json(); } catch (e) {}
    if (!r.ok) {
      const e = new Error((json && json.erro) || ("HTTP " + r.status));
      e.status = r.status;
      e.code = r.status === 404 ? "not-found" : r.status === 403 ? "permission-denied" : "unavailable";
      throw e;
    }
    return json;
  }

  // ---------- Assinaturas ao vivo ----------
  const ouvintes = new Set();
  let timerRecarga = null;

  function marcarAlterado(caminho) {
    const col = colecaoDe(caminho);
    ouvintes.forEach((o) => { if (o.colecao ? o.colecao === col : o.caminho === caminho) o.sujo = true; });
    agendar();
  }
  function marcarTodos() { ouvintes.forEach((o) => { o.sujo = true; }); agendar(); }
  function agendar() {
    if (timerRecarga) return;
    timerRecarga = setTimeout(() => {
      timerRecarga = null;
      ouvintes.forEach((o) => { if (o.sujo) { o.sujo = false; o.buscar(); } });
    }, 60);
  }

  let fonte = null;
  function conectarEventos() {
    try {
      fonte = new EventSource("/api/eventos", { withCredentials: true });
      fonte.onmessage = (ev) => {
        try { (JSON.parse(ev.data).caminhos || []).forEach(marcarAlterado); } catch (e) {}
      };
      fonte.onopen = () => { if (conectarEventos.jaConectou) marcarTodos(); conectarEventos.jaConectou = true; };
      // o EventSource reconecta sozinho; ao voltar, onopen recarrega tudo (eventos perdidos)
    } catch (e) {
      // sem SSE: recarrega periodicamente
      setInterval(marcarTodos, 15000);
    }
  }
  // Rede de segurança: se uma aba ficar muito tempo parada, recarrega ao voltar.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) marcarTodos(); });

  function assinar(o) {
    ouvintes.add(o);
    if (!fonte) conectarEventos();
    o.buscar();
    return () => ouvintes.delete(o);
  }

  // ---------- Snapshots ----------
  function docSnap(caminho, existe, dados) {
    return {
      id: idDe(caminho), exists: !!existe,
      data: () => (existe ? clone(dados) : undefined),
      get: (campo) => (existe && dados ? dados[campo] : undefined),
      ref: referenciaDoc(caminho),
    };
  }
  function querySnap(colecao, docs) {
    const lista = docs.map((d) => docSnap(colecao + "/" + d.id, true, d.dados));
    return { docs: lista, empty: !lista.length, size: lista.length, metadata: { fromCache: false, hasPendingWrites: false }, forEach: (fn) => lista.forEach(fn) };
  }

  // ---------- Consultas ----------
  function consulta(colecao, filtro) {
    const q = Object.assign({ where: [], orderBy: null, limit: 0 }, filtro || {});
    const derivar = (mud) => consulta(colecao, Object.assign({}, q, mud));
    const executar = async () => {
      const r = await chamar("/colecao/consultar", { colecao, where: q.where, orderBy: q.orderBy, limit: q.limit });
      return querySnap(colecao, r.docs || []);
    };
    return {
      where: (campo, op, valor) => derivar({ where: q.where.concat([[campo, op, valor === undefined ? null : valor]]) }),
      orderBy: (campo, dir) => derivar({ orderBy: [campo, dir || "asc"] }),
      limit: (n) => derivar({ limit: n }),
      get: executar,
      onSnapshot: (aoReceber, aoFalhar) => {
        let seq = 0;
        return assinar({
          colecao,
          buscar: () => {
            const meu = ++seq;
            executar().then((s) => { if (meu === seq) aoReceber(s); }).catch((e) => { if (meu === seq && aoFalhar) aoFalhar(e); });
          },
        });
      },
      add: async (dados) => {
        const r = await chamar("/colecao/adicionar", { colecao, dados: clone(dados) });
        marcarAlterado(colecao + "/" + r.id);
        return referenciaDoc(colecao + "/" + r.id);
      },
      doc: (id) => referenciaDoc(colecao + "/" + (id || gerarId())),
    };
  }

  function gerarId() {
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    const b = crypto.getRandomValues(new Uint8Array(20));
    let s = "";
    for (let i = 0; i < 20; i++) s += a[b[i] % a.length];
    return s;
  }

  function referenciaDoc(caminho) {
    const ler = async () => {
      const r = await chamar("/doc/ler", { caminho });
      return docSnap(caminho, r.existe, r.dados);
    };
    return {
      id: idDe(caminho), path: caminho,
      get: ler,
      set: async (dados, opcoes) => {
        await chamar("/doc/gravar", { caminho, dados: clone(dados), merge: !!(opcoes && opcoes.merge) });
        marcarAlterado(caminho);
      },
      update: async (dados) => {
        await chamar("/doc/atualizar", { caminho, dados: clone(dados) });
        marcarAlterado(caminho);
      },
      delete: async () => {
        await chamar("/doc/apagar", { caminho });
        marcarAlterado(caminho);
      },
      onSnapshot: (aoReceber, aoFalhar) => {
        let seq = 0;
        return assinar({
          caminho,
          buscar: () => {
            const meu = ++seq;
            ler().then((s) => { if (meu === seq) aoReceber(s); }).catch((e) => { if (meu === seq && aoFalhar) aoFalhar(e); });
          },
        });
      },
      collection: (sub) => consulta(caminho + "/" + sub),
    };
  }

  const db = {
    collection: (c) => consulta(c),
    doc: (caminho) => referenciaDoc(caminho),
    batch: () => {
      const ops = [];
      return {
        set: (ref, dados, opcoes) => { ops.push({ tipo: "set", caminho: ref.path, dados: clone(dados), merge: !!(opcoes && opcoes.merge) }); },
        update: (ref, dados) => { ops.push({ tipo: "update", caminho: ref.path, dados: clone(dados) }); },
        delete: (ref) => { ops.push({ tipo: "delete", caminho: ref.path }); },
        commit: async () => { await chamar("/lote", { ops }); ops.forEach((o) => marcarAlterado(o.caminho)); },
      };
    },
    // Transação simplificada: lê na hora e grava em lote no final (sem nova tentativa em conflito).
    runTransaction: async (fn) => {
      const lote = db.batch();
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, d, o) => { lote.set(ref, d, o); return tx; },
        update: (ref, d) => { lote.update(ref, d); return tx; },
        delete: (ref) => { lote.delete(ref); return tx; },
      };
      const resultado = await fn(tx);
      await lote.commit();
      return resultado;
    },
  };

  // ---------- Anexos ----------
  const assets = {
    upload: async (arquivo) => {
      const r = await fetch("/api/anexos", {
        method: "POST",
        headers: { "Content-Type": arquivo.type || "application/octet-stream", "X-Nome-Arquivo": encodeURIComponent(arquivo.name || "arquivo") },
        body: arquivo,
        credentials: "same-origin",
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.erro || "falha no envio do anexo");
      return json;
    },
    delete: async (id) => {
      const r = await fetch("/api/anexos/" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" });
      if (!r.ok) throw new Error("falha ao apagar o anexo");
    },
  };

  // ---------- Downloads ----------
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename || "arquivo";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };

  const capacidades = { db, assets, downloads };
  window.claude = Object.assign(window.claude || {}, {
    use: (nome) => Promise.resolve(capacidades[nome] || null),
  });
})();
