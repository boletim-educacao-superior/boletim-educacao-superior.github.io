// Testes do servidor de acesso (Acesso.gs) sem o Google: simula os serviços do Apps Script em Node.
// Rodar:  node acesso/teste/testar.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

// ------------------------------------------------------------ simulador --
function novoAmbiente() {
  const props = {}, cache = {}, emails = [], planilhas = {}, pastas = {};
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
      formatDate: (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().replace("T", " ").slice(0, 19),
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
      sendEmail(para, assunto, corpo) { this.cota--; emails.push({ para, assunto, corpo }); },
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
    ScriptApp: { getScriptId: () => "script-radar" },
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "Acesso.gs"), "utf8"), g);

  const chamar = (corpo) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(corpo) } }).texto);
  return {
    g, props, emails, planilhas, pastas,
    chamar,
    avancar: (min) => { relogio += min * 60e3; },
    ultimoCodigo: (para) => { const e = emails.filter((x) => x.para === para).pop(); return e && (e.assunto.match(/(\d{6})/) || [])[1]; },
    api: (sessao, nome, ...args) => chamar({ acao: "api", sessao, nome, args }),
    aba: (nome) => Object.values(planilhas)[0].getSheetByName(nome).dados,
  };
}

// ---------------------------------------------------------------- testes --
let falhas = 0, total = 0;
function conferir(descricao, condicao, extra) {
  total++;
  if (condicao) console.log("  ok  " + descricao);
  else { falhas++; console.log("  FALHOU  " + descricao + (extra !== undefined ? "  →  " + JSON.stringify(extra) : "")); }
}
function cenario(nome, fn) { console.log("\n" + nome); fn(novoAmbiente()); }

const DIEGO = "diegoeduardo@pucminas.br";
const ANA = "ana.teste@pucminas.br";
const SENHA = "radar2026ok";

function primeiroAcesso(a, email, senha) {
  a.avancar(2); // o servidor só aceita um pedido de código por minuto
  a.chamar({ acao: "pedirCodigo", email });
  return a.chamar({ acao: "definirSenha", email, codigo: a.ultimoCodigo(email), senha });
}

cenario("Configuração", (a) => {
  a.g.configurar();
  conferir("cria segredo e planilha", !!a.props.SEGREDO && !!a.props.PLANILHA_ID);
  const equipe = a.aba("Equipe");
  conferir("cabeçalho da Equipe", equipe[0].join() === "email,nome,admin,cadastrado_por,cadastrado_em,boasvindas_em,senha,senha_em,ultimo_acesso", equipe[0]);
  conferir("Diego entra como administrador", equipe[1][0] === DIEGO && equipe[1][2] === true);
  const pasta = "1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe"; // PASTA_ID do Acesso.gs
  conferir("planilha vai para a pasta do Radar", a.pastas[a.props.PLANILHA_ID] === pasta, a.pastas);
  conferir("script vai para a pasta do Radar", a.pastas["script-radar"] === pasta, a.pastas);
  a.g.configurar();
  conferir("rodar de novo não duplica", a.aba("Equipe").length === 2);
});

cenario("Primeiro acesso, entrada e sessão", (a) => {
  a.g.configurar();
  let r = a.chamar({ acao: "pedirCodigo", email: "fora@exemplo.com" });
  conferir("e-mail fora da equipe é recusado com aviso", !r.ok && /não está cadastrado/.test(r.erro), r);
  conferir("nenhum e-mail sai para quem não é da equipe", a.emails.length === 0);

  r = a.chamar({ acao: "entrar", email: DIEGO, senha: "qualquer1" });
  conferir("sem senha criada, orienta o primeiro acesso", !r.ok && /Primeiro acesso/.test(r.erro), r);

  r = a.chamar({ acao: "pedirCodigo", email: DIEGO.toUpperCase() });
  conferir("pede código (e-mail em maiúsculas)", r.ok, r);
  const codigo = a.ultimoCodigo(DIEGO);
  conferir("código de 6 dígitos chega por e-mail", /^\d{6}$/.test(codigo || ""));
  r = a.chamar({ acao: "pedirCodigo", email: DIEGO });
  conferir("segundo pedido no mesmo minuto é barrado", !r.ok && /Aguarde/.test(r.erro), r);

  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo, senha: "curta1" });
  conferir("senha curta é recusada", !r.ok && /pelo menos 8/.test(r.erro), r);
  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo, senha: "somenteletras" });
  conferir("senha sem número é recusada", !r.ok && /letras e números/.test(r.erro), r);
  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo, senha: "diegoeduardo1" });
  conferir("senha com o e-mail é recusada", !r.ok && /e-mail/.test(r.erro), r);
  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo: "000000", senha: SENHA });
  conferir("código errado é recusado e conta tentativas", !r.ok && /Restam 4/.test(r.erro), r);

  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo, senha: SENHA });
  conferir("código certo cria a senha e abre sessão", r.ok && r.dados.sessao && r.dados.perfil.admin, r);
  const guardada = a.aba("Equipe")[1][6];
  conferir("planilha guarda só o hash", /^v1\$2000\$/.test(guardada) && guardada.indexOf(SENHA) < 0, guardada);
  r = a.chamar({ acao: "definirSenha", email: DIEGO, codigo, senha: SENHA });
  conferir("código não pode ser usado duas vezes", !r.ok && /expirado/.test(r.erro), r);

  r = a.chamar({ acao: "entrar", email: DIEGO, senha: "errada123" });
  conferir("senha errada: mensagem genérica", !r.ok && r.erro === "E-mail ou senha incorretos.", r);
  r = a.chamar({ acao: "entrar", email: "fora@exemplo.com", senha: "errada123" });
  conferir("e-mail desconhecido: mesma mensagem", !r.ok && r.erro === "E-mail ou senha incorretos.", r);
  r = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA });
  conferir("senha certa entra", r.ok && r.dados.perfil.nome === "Diego Eduardo", r);
  const sessao = r.dados.sessao;

  r = a.api(sessao, "perfil");
  conferir("sessão válida devolve o perfil", r.ok && r.dados.email === DIEGO, r);
  conferir("sessão guardada só como hash", !Object.keys(a.props).some((k) => k.indexOf(sessao) >= 0));
  r = a.api("sessao-inventada", "perfil");
  conferir("sessão inventada é recusada", !r.ok && r.erro === "SESSAO_INVALIDA", r);
  r = a.api(sessao, "naoExiste");
  conferir("ação desconhecida é recusada", !r.ok && /desconhecida/.test(r.erro), r);

  a.chamar({ acao: "sair", sessao });
  r = a.api(sessao, "perfil");
  conferir("depois de sair, a sessão não vale mais", !r.ok && r.erro === "SESSAO_INVALIDA", r);
});

cenario("Bloqueio por senha errada", (a) => {
  a.g.configurar();
  primeiroAcesso(a, DIEGO, SENHA);
  for (let i = 0; i < 5; i++) a.chamar({ acao: "entrar", email: DIEGO, senha: "errada" + i + "x" });
  let r = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA });
  conferir("após 5 erros, bloqueia até a senha certa", !r.ok && /Aguarde 15 minutos/.test(r.erro), r);
  a.avancar(16);
  r = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA });
  conferir("depois de 15 minutos, volta a entrar", r.ok, r);
});

cenario("Administração da equipe", (a) => {
  a.g.configurar();
  const adm = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;

  let r = a.api(adm, "salvarMembro", ANA, "Ana Teste", false, true);
  conferir("admin cadastra pessoa", r.ok && r.dados.some((p) => p.email === ANA && !p.admin && !p.tem_senha), r);
  const bv = a.emails.filter((e) => e.para === ANA).pop();
  conferir("e-mail de boas-vindas com o link e o passo a passo", bv && /Primeiro acesso/.test(bv.corpo) && /certificacao-cinea\.github\.io\/radar/.test(bv.corpo));
  conferir("lista da equipe não expõe hash de senha", !JSON.stringify(r.dados).includes("v1$"));

  r = a.api(adm, "salvarMembro", "=HIPERLINK(\"x\")@a.com", "x", false, false);
  conferir("e-mail inválido é recusado", !r.ok, r);
  r = a.api(adm, "salvarMembro", "beto@pucminas.br", "=IMPORTXML(\"http://x\")", false, false);
  conferir("nome com fórmula é gravado como texto", r.ok && a.aba("Equipe").some((l) => l[1] === "'=IMPORTXML(\"http://x\")"), r);

  const ana = primeiroAcesso(a, ANA, "outra2026senha").dados.sessao;
  r = a.api(ana, "equipe");
  conferir("quem não é admin não vê a equipe", !r.ok && /administradores/.test(r.erro), r);
  r = a.api(ana, "registro");
  conferir("quem não é admin não vê o registro", !r.ok, r);
  r = a.api(ana, "salvarMembro", "x@y.com", "X", true, false);
  conferir("quem não é admin não cadastra", !r.ok, r);

  r = a.api(adm, "apagarSenha", ANA);
  conferir("admin apaga a senha de alguém", r.ok && r.dados.find((p) => p.email === ANA).tem_senha === false, r);
  r = a.api(ana, "perfil");
  conferir("com a senha apagada, a sessão dela cai", !r.ok && r.erro === "SESSAO_INVALIDA", r);

  const ana2 = primeiroAcesso(a, ANA, "nova2026senha").dados.sessao;
  r = a.api(adm, "removerMembro", ANA);
  conferir("admin remove pessoa", r.ok && !r.dados.some((p) => p.email === ANA), r);
  r = a.api(ana2, "perfil");
  conferir("pessoa removida perde a sessão na hora", !r.ok && r.erro === "SESSAO_INVALIDA", r);
  r = a.api(adm, "removerMembro", DIEGO);
  conferir("admin não remove a si mesmo", !r.ok && /si mesmo/.test(r.erro), r);

  r = a.api(adm, "registro");
  const acoes = r.ok ? r.dados.map((x) => x.acao) : [];
  conferir("registro guarda cadastro, remoção e senhas", ["membro_cadastrado", "membro_removido", "senha_apagada", "senha_criada"].every((x) => acoes.includes(x)), acoes);
  conferir("registro nunca contém código ou senha", !JSON.stringify(a.aba("Registro")).match(/radar2026ok|nova2026senha|\b\d{6}\b(?!.*:)/));
});

cenario("Troca de senha", (a) => {
  a.g.configurar();
  const s1 = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  const s2 = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA }).dados.sessao;
  let r = a.api(s1, "alterarSenha", "errada123", "nova2026abc");
  conferir("senha atual errada é recusada", !r.ok && /não confere/.test(r.erro), r);
  r = a.api(s1, "alterarSenha", SENHA, "nova2026abc");
  conferir("troca a senha e devolve sessão nova", r.ok && r.dados.sessao, r);
  conferir("a sessão nova funciona", a.api(r.dados.sessao, "perfil").ok);
  conferir("sessões antigas (outros navegadores) caem", !a.api(s2, "perfil").ok && !a.api(s1, "perfil").ok);
  conferir("senha antiga não entra mais", !a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA }).ok);
  conferir("senha nova entra", a.chamar({ acao: "entrar", email: DIEGO, senha: "nova2026abc" }).ok);
});

cenario("Cota de e-mail compartilhada com os certificados", (a) => {
  a.g.configurar();
  a.g.MailApp.cota = 30;
  const r = a.chamar({ acao: "pedirCodigo", email: DIEGO });
  conferir("com 30 e-mails restantes, o Radar não envia (reserva dos certificados)", !r.ok && /limite de e-mails/.test(r.erro) && a.emails.length === 0, r);
});

cenario("Erros internos não vazam", (a) => {
  const r = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA }); // sem configurar(): planilha não existe
  conferir("servidor sem configuração avisa com mensagem própria", !r.ok && /configurar/.test(r.erro), r);
  a.g.configurar();
  a.g.SpreadsheetApp.openById = () => { throw new TypeError("detalhe interno do Google"); };
  const r2 = a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA });
  conferir("erro interno vira mensagem genérica", !r2.ok && r2.erro === "Erro no servidor. Tente de novo em instantes.", r2);
});

console.log(`\n${total - falhas} de ${total} verificações passaram.`);
process.exit(falhas ? 1 : 0);
