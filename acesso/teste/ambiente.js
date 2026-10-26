// Simulador dos serviços do Google usados pelo Acesso.gs (Planilha, Propriedades, Cache, E-mail, Drive, gatilhos, UrlFetch).
// Usado pelos testes (testar.js) e pela prévia dos e-mails (previa-emails.js).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
// ------------------------------------------------------------ simulador --
function novoAmbiente() {
  const props = {}, cache = {}, emails = [], planilhas = {}, pastas = {}, gatilhos = [];
  const avisos = { gerado_em: "", itens: [] }, buscas = [];
  let relogio = Date.parse("2026-10-23T12:00:00Z");

  const toBytes = (v) => (Array.isArray(v) ? Buffer.from(v.map((b) => b & 255)) : Buffer.from(String(v), "utf8"));
  const toSigned = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));

  class Aba {
    constructor(nome) { this.nome = nome; this.dados = []; }
    getName() { return this.nome; }
    setName(n) { this.nome = n; }
    getLastRow() { return this.dados.length; }
    appendRow(l) { this.dados.push(l.slice()); }
    deleteRow(i) { this.dados.splice(i - 1, 1); }
    setFrozenRows() {}
    getDataRange() { const d = this.dados; return { getValues: () => d.map((l) => l.slice()) }; }
    getRange(linha, col, nl = 1, nc = 1) {
      const d = this.dados;
      const garantir = () => { while (d.length < linha + nl - 1) d.push([]); };
      const r = {
        setValues(v) { garantir(); v.forEach((l, i) => l.forEach((x, j) => (d[linha - 1 + i][col - 1 + j] = x))); return r; },
        setValue(x) { garantir(); d[linha - 1][col - 1] = x; return r; },
        setFontWeight() { return r; },
      };
      return r;
    }
  }
  class Planilha {
    constructor(nome) { this.nome = nome; this.abas = [new Aba("Página1")]; this.id = "planilha-" + Object.keys(planilhas).length; }
    getId() { return this.id; }
    getUrl() { return "https://docs.google.com/" + this.id; }
    getSheets() { return this.abas; }
    getSheetByName(n) { return this.abas.find((a) => a.nome === n) || null; }
    insertSheet(n) { const a = new Aba(n); this.abas.push(a); return a; }
  }

  const g = {
    console,
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(relogio); }
      static now() { return relogio; }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      newBlob: (s) => ({ getBytes: () => toSigned(Buffer.from(String(s), "utf8")) }),
      computeHmacSha256Signature: (valor, chave) => toSigned(crypto.createHmac("sha256", toBytes(chave)).update(toBytes(valor)).digest()),
      base64EncodeWebSafe: (b) => toBytes(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      formatDate: (d, fuso, formato) => {
        const t = new Date(d.getTime() - 3 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
        if (formato === "dd/MM") return t.slice(8, 10) + "/" + t.slice(5, 7);
        return formato === "yyyy-MM-dd" ? t.slice(0, 10) : t;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: (o) => Object.assign(props, o),
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => Object.assign({}, props),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache[k] && cache[k].ate > relogio ? cache[k].v : null),
        put: (k, v, s) => { cache[k] = { v: String(v), ate: relogio + s * 1000 }; },
        remove: (k) => { delete cache[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: {
      create: (n) => { const p = new Planilha(n); planilhas[p.id] = p; return p; },
      openById: (id) => planilhas[id],
    },
    MailApp: {
      cota: 100,
      getRemainingDailyQuota() { return this.cota; },
      sendEmail(para, assunto, corpo, op) { this.cota--; emails.push({ para, assunto, corpo, html: (op || {}).htmlBody || "" }); },
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }),
    },
    Logger: { log: () => {} },
    // Drive: cada arquivo guarda em que pasta está; moveTo troca a pasta.
    DriveApp: {
      getFolderById: (id) => ({ getId: () => id, getUrl: () => "https://drive.google.com/" + id }),
      getFileById: (id) => ({
        getParents: () => { const p = pastas[id]; let lido = false; return { hasNext: () => !!p && !lido, next: () => { lido = true; return { getId: () => p }; } }; },
        moveTo: (pasta) => { pastas[id] = pasta.getId(); },
      }),
    },
    ScriptApp: {
      getScriptId: () => "script-radar",
      WeekDay: { MONDAY: "MONDAY" },
      getProjectTriggers: () => gatilhos.map((g) => ({ getHandlerFunction: () => g.funcao })),
      newTrigger: (funcao) => {
        const g = { funcao };
        const b = { timeBased: () => b, everyMinutes: (m) => { g.minutos = m; return b; }, onWeekDay: (d) => { g.dia = d; return b; },
                    atHour: (h) => { g.hora = h; return b; }, create: () => { gatilhos.push(g); return g; } };
        return b;
      },
    },
    // O avisos.json publicado pelo coletor (o teste muda "avisos" para simular uma coleta nova).
    UrlFetchApp: {
      fetch: (url) => { buscas.push(url); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(avisos) }; },
    },
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "Acesso.gs"), "utf8"), g);

  const chamar = (corpo) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(corpo) } }).texto);
  return {
    g, props, emails, planilhas, pastas, gatilhos, avisos, buscas,
    chamar,
    avancar: (min) => { relogio += min * 60e3; },
    ultimoCodigo: (para) => { const e = emails.filter((x) => x.para === para).pop(); return e && (e.assunto.match(/(\d{6})/) || [])[1]; },
    api: (sessao, nome, ...args) => chamar({ acao: "api", sessao, nome, args }),
    aba: (nome) => Object.values(planilhas)[0].getSheetByName(nome).dados,
  };
}

module.exports = { novoAmbiente };
