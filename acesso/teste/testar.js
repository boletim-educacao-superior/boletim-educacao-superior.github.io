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
      formatDate: (d, fuso, formato) => {
        const t = new Date(d.getTime() - 3 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
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
  conferir("cabeçalho da Equipe", equipe[0].join() === "email,nome,admin,cadastrado_por,cadastrado_em,boasvindas_em,senha,senha_em,ultimo_acesso,visita_anterior,perfil", equipe[0]);
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
  conferir("planilha guarda só o hash", /^v1\$500\$/.test(guardada) && guardada.indexOf(SENHA) < 0, guardada);
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

cenario("Senha guardada com 2000 repetições (versão anterior) continua valendo", (a) => {
  a.g.configurar();
  primeiroAcesso(a, DIEGO, SENHA);
  const linha = a.aba("Equipe")[1];
  const sal = linha[6].split("$")[2];
  linha[6] = vmHash(a, SENHA, sal, 2000);
  conferir("entra com a senha antiga", a.chamar({ acao: "entrar", email: DIEGO, senha: SENHA }).ok);
  conferir("senha errada continua barrada", !a.chamar({ acao: "entrar", email: DIEGO, senha: "outra2026x" }).ok);
});
function vmHash(a, senha, sal, it) { return vm.runInContext(`hashSenha_(${JSON.stringify(senha)}, ${JSON.stringify(sal)}, ${it})`, a.g); }

cenario("Meu perfil", (a) => {
  a.g.configurar();
  const s = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  let r = a.api(s, "perfil");
  conferir("perfil traz cadastro e data da senha", r.ok && r.dados.cadastrado_por === "cineaned@gmail.com" && !!r.dados.senha_em && r.dados.admin, r);
  conferir("perfil não traz o hash da senha", !JSON.stringify(r.dados).includes("v1$"));
  r = a.api(s, "salvarMeuNome", "  Diego   E. Silva ");
  conferir("troca o próprio nome (espaços arrumados)", r.ok && r.dados.nome === "Diego E. Silva", r);
  conferir("planilha guarda o nome novo", a.aba("Equipe")[1][1] === "Diego E. Silva");
  r = a.api(s, "salvarMeuNome", "   ");
  conferir("nome vazio é recusado", !r.ok && /Digite o seu nome/.test(r.erro), r);
  r = a.api(s, "salvarMeuNome", "=HYPERLINK(1)");
  conferir("nome com fórmula vira texto", r.ok && a.aba("Equipe")[1][1] === "'=HYPERLINK(1)", a.aba("Equipe")[1]);
});

cenario("Marcações: sinalizada, sem relevância e lidas", (a) => {
  a.g.configurar();
  const adm = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  a.api(adm, "salvarMembro", ANA, "Ana Teste", false, false);
  const ana = primeiroAcesso(a, ANA, "outra2026senha").dados.sessao;
  const N1 = "0123456789abcdef", N2 = "fedcba9876543210";

  let r = a.api(ana, "marcar", N1, "sinalizada", true, "", "Portaria SERES 1", "https://www.in.gov.br/x");
  conferir("pessoa da equipe sinaliza", r.ok && r.dados.length === 1 && r.dados[0].tipo === "sinalizada" && r.dados[0].nome === "Ana Teste", r);
  r = a.api(adm, "marcacoes");
  conferir("a sinalização é vista pela equipe toda", r.ok && r.dados.marcas.some((m) => m.id === N1 && m.por === ANA), r);
  r = a.api(adm, "marcar", N1, "irrelevante", true, "  Ato de outra IES  ", "Portaria SERES 1", "javascript:alert(1)");
  conferir("marcar sem relevância tira a sinalização", r.ok && r.dados.length === 1 && r.dados[0].tipo === "irrelevante" && r.dados[0].motivo === "Ato de outra IES", r);
  conferir("link que não é https não é gravado", a.aba("Marcacoes")[1][6] === "", a.aba("Marcacoes")[1]);
  r = a.api(adm, "marcar", N1, "irrelevante", false);
  conferir("desfazer tira a marcação", r.ok && r.dados.length === 0, r);
  r = a.api(adm, "marcar", "../../etc", "sinalizada", true);
  conferir("id de notícia inválido é recusado", !r.ok && /inválida/.test(r.erro), r);
  r = a.api(adm, "marcar", N1, "apagar", true);
  conferir("tipo de marcação inválido é recusado", !r.ok, r);

  r = a.api(ana, "marcarLidos", [N1, N2, N1, "lixo"], true);
  conferir("marca lidas (ignora repetidas e inválidas)", r.ok && a.aba("Lidos").length === 3, a.aba("Lidos"));
  a.api(adm, "marcarLidos", [N1], true);
  conferir("outra pessoa lendo de novo não duplica (fica quem leu primeiro)", a.aba("Lidos").length === 3);
  const lidosAdm = a.api(adm, "marcacoes").dados.lidos;
  conferir("lidas são da equipe: o admin vê o que a Ana leu, com o nome dela",
    lidosAdm.length === 2 && lidosAdm.every((l) => l.por === ANA && l.nome === "Ana Teste"), lidosAdm);
  a.api(adm, "marcarLidos", [N2], false);
  conferir("não lida volta para todos", JSON.stringify(a.api(ana, "marcacoes").dados.lidos.map((l) => l.id)) === JSON.stringify([N1]));
  conferir("voltar para não lida entra no registro", a.api(adm, "registro").dados.some((x) => x.acao === "item_nao_lida"));
  const acoes = a.api(adm, "registro").dados.map((x) => x.acao);
  conferir("sinalizar e desfazer entram no registro", ["item_sinalizada", "item_irrelevante", "item_irrelevante_desfeito"].every((x) => acoes.includes(x)), acoes);
});

cenario("Painel aberto: leitura pública, uso e última visita", (a) => {
  a.g.configurar();
  const adm = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  const N1 = "0123456789abcdef", N2 = "fedcba9876543210";
  a.api(adm, "marcar", N1, "irrelevante", true, "Ato de outra IES", "T1", "https://x.gov.br/1");
  a.api(adm, "marcar", N2, "sinalizada", true, "", "T2", "https://x.gov.br/2");
  let r = a.chamar({ acao: "publico" });
  conferir("visitante vê só os ids sem relevância, sem nomes", r.ok && JSON.stringify(r.dados) === JSON.stringify({ irrelevantes: [N1] }), r);
  a.api(adm, "marcar", N1, "irrelevante", false);
  r = a.chamar({ acao: "publico" });
  conferir("desmarcar atualiza o que o visitante vê na hora", r.ok && r.dados.irrelevantes.length === 0, r);

  const V1 = "visitante0001", V2 = "visitante0002";
  conferir("evento de visitante é registrado", a.chamar({ acao: "evento", visitante: V1, tipo: "abertura", detalhe: "inicio", dispositivo: "celular" }).dados === true);
  a.chamar({ acao: "evento", visitante: V1, tipo: "noticia", detalhe: "MEC|urgente|Portaria X" });
  a.chamar({ acao: "evento", visitante: V2, tipo: "abertura", sessao: adm, detalhe: "inicio" });
  a.chamar({ acao: "evento", visitante: V2, tipo: "busca", detalhe: "  Marco   Regulatório " });
  conferir("evento inválido é ignorado sem erro", a.chamar({ acao: "evento", visitante: "x", tipo: "abertura" }).dados === false
    && a.chamar({ acao: "evento", visitante: V1, tipo: "apagarTudo" }).dados === false);
  conferir("evento com fórmula vira texto", a.chamar({ acao: "evento", visitante: V1, tipo: "busca", detalhe: "=IMPORTXML(1)" }).ok
    && a.aba("Acessos").some((l) => l[4] === "'=IMPORTXML(1)"));
  const linhaEquipe = a.aba("Acessos").find((l) => l[1] === V2 && l[3] === "abertura");
  conferir("evento com sessão guarda o e-mail; sem sessão, não", linhaEquipe[2] === DIEGO && a.aba("Acessos").find((l) => l[1] === V1)[2] === "");

  r = a.api(adm, "uso", 30);
  const u = r.dados || {};
  conferir("relatório conta aberturas, equipe e público", r.ok && u.aberturas === 2 && u.aberturas_equipe === 1 && u.aberturas_publico === 1 && u.aberturas_usuarios === 0, u);
  conferir("relatório traz visitantes únicos e dispositivo", u.visitantes === 2 && u.visitantes_publico === 1 && u.dispositivos.celular === 1, u);
  conferir("mapa de calor tem 7 dias x 24 horas e soma as aberturas", u.calor.length === 7 && u.calor.every((d) => d.length === 24)
    && u.calor.flat().reduce((x, y) => x + y, 0) === 2);
  conferir("série diária com 30 dias", u.serie.length === 30 && u.serie.at(-1).equipe === 1 && u.serie.at(-1).publico === 1, u.serie.at(-1));
  conferir("top de instituições, notícias e buscas", u.instituicoes[0].chave === "MEC" && u.noticias[0].chave === "Portaria X"
    && u.buscas.some((b) => b.chave === "marco regulatório"), u);
  conferir("quem da equipe usa, com nome", u.equipe.length === 1 && u.equipe[0].nome === "Diego Eduardo");
  a.api(adm, "salvarMembro", ANA, "Ana Teste", false, false);
  const ana = primeiroAcesso(a, ANA, "outra2026senha").dados.sessao;
  conferir("relatório de uso é só para administradores", !a.api(ana, "uso", 30).ok);

  // última visita: a segunda visita (mais de 30 min depois) mostra quando foi a primeira
  let p1 = a.api(ana, "perfil").dados;
  conferir("primeira visita não tem visita anterior", p1.visita_anterior === "", p1);
  a.avancar(45);
  const p2 = a.api(ana, "perfil").dados;
  conferir("depois de 30 min, a visita anterior é o acesso passado", p2.visita_anterior === p1.ultimo_acesso && p2.ultimo_acesso > p1.ultimo_acesso, [p1, p2]);
  a.avancar(5);
  const p3 = a.api(ana, "perfil").dados;
  conferir("dentro da mesma visita, a visita anterior não muda", p3.visita_anterior === p2.visita_anterior, [p2, p3]);
});

cenario("Cadastro aberto: perfil Usuário com marcações pessoais", (a) => {
  a.g.configurar();
  const adm = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  const BIA = "bia.externa@gmail.com", N1 = "0123456789abcdef", N2 = "fedcba9876543210";
  a.avancar(2);
  let r = a.chamar({ acao: "cadastrar", nome: "Bia Externa", email: BIA });
  conferir("qualquer pessoa cria conta e recebe o código", r.ok && /^\d{6}$/.test(a.ultimoCodigo(BIA) || ""), r);
  const linha = a.aba("Equipe").find((l) => l[0] === BIA);
  conferir("conta nasce com perfil usuário, sem admin, cadastrada por autocadastro", linha[10] === "usuario" && linha[2] === false && linha[3] === "autocadastro", linha);
  r = a.chamar({ acao: "definirSenha", email: BIA, codigo: a.ultimoCodigo(BIA), senha: "bia2026senha" });
  conferir("cria a senha e entra", r.ok && r.dados.perfil.tipo === "usuario" && !r.dados.perfil.admin, r);
  const bia = r.dados.sessao;
  a.avancar(2);
  r = a.chamar({ acao: "cadastrar", nome: "Bia", email: BIA });
  conferir("cadastrar de novo um e-mail que já tem conta é recusado", !r.ok && /já tem conta/.test(r.erro), r);
  r = a.chamar({ acao: "cadastrar", nome: "A", email: "x@y.com" });
  conferir("nome curto demais é recusado", !r.ok && /seu nome/.test(r.erro), r);

  a.api(adm, "marcar", N2, "irrelevante", true, "Fora do escopo", "T2", "https://x.gov.br/2");
  r = a.api(bia, "marcar", N1, "sinalizada", true, "", "T1", "https://x.gov.br/1");
  conferir("usuário sinaliza só para si", r.ok && r.dados.some((m) => m.id === N1 && m.pessoal), r);
  conferir("a sinalização dele não aparece para a equipe", !a.api(adm, "marcacoes").dados.marcas.some((m) => m.id === N1));
  conferir("usuário recebe as 'sem relevância' da equipe (só o id)", r.dados.some((m) => m.id === N2 && m.tipo === "irrelevante" && !m.nome), r.dados);
  r = a.api(bia, "marcar", N1, "irrelevante", true, "x", "T1", "https://x.gov.br/1");
  conferir("usuário não marca sem relevância", !r.ok && /Só a equipe/.test(r.erro), r);
  a.api(bia, "marcarLidos", [N1], true);
  conferir("lida do usuário é pessoal", a.api(bia, "marcacoes").dados.lidos.length === 1 && a.api(adm, "marcacoes").dados.lidos.length === 0);
  conferir("usuário não vê a equipe nem o relatório", !a.api(bia, "equipe").ok && !a.api(bia, "uso", 30).ok);

  r = a.api(adm, "equipe");
  conferir("admin vê a pessoa com perfil usuário", r.ok && r.dados.find((p) => p.email === BIA).perfil === "usuario", r);
  r = a.api(adm, "salvarMembro", BIA, "Bia Externa", false, false, "equipe");
  conferir("admin promove usuário a equipe", r.ok && r.dados.find((p) => p.email === BIA).perfil === "equipe", r);
  conferir("promovida, passa a marcar para todos", a.api(bia, "marcar", N1, "sinalizada", true, "", "T1", "https://x").ok
    && a.api(adm, "marcacoes").dados.marcas.some((m) => m.id === N1 && m.por === BIA));

  for (let i = 0; i < 15; i++) { a.avancar(2); a.chamar({ acao: "cadastrar", nome: "Pessoa " + i, email: `p${i}@exemplo.com` }); }
  r = a.chamar({ acao: "cadastrar", nome: "Mais Uma", email: "extra@exemplo.com" });
  conferir("limite de cadastros por dia", !r.ok && /limite de cadastros/.test(r.erro), r);
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
