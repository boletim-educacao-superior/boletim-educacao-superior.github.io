// Entrada no Radar: e-mail e senha, primeiro acesso / esqueci a senha (código por e-mail),
// troca de senha e área do administrador. Conversa com o servidor de acesso (acesso/Acesso.gs, Apps Script).
//
// Importante: isto organiza QUEM usa o painel. Os dados do Radar continuam públicos no GitHub
// (decisão de 23/10/2026); a entrada não é uma proteção dos dados.

const ACESSO = {
  // Endereço do App da Web do Apps Script (termina em /exec). Ver acesso/README.md.
  url: "https://script.google.com/macros/s/AKfycbxgKFOecHcd4-nfNhmtiZbPWP8F9J4AX2Y5Wjm6iJDDXgfig6tNl6zcC7sb4lSmS-3Q/exec",
};

const CHAVE_SESSAO = "radar.sessao";
const Acesso = { sessao: null, perfil: null };
const $a = (id) => document.getElementById(id);

// ------------------------------------------------------------- servidor --
function lerSessao() { try { return localStorage.getItem(CHAVE_SESSAO); } catch { return null; } }
function gravarSessao(s) {
  Acesso.sessao = s;
  try { s ? localStorage.setItem(CHAVE_SESSAO, s) : localStorage.removeItem(CHAVE_SESSAO); } catch { /* modo privado */ }
}

// Em localhost, ?acesso=simulado usa o simulador (docs/simulador-acesso.js) para testar as telas sem o Google.
function urlServidor() {
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && new URLSearchParams(location.search).get("acesso") === "simulado") return "simulado";
  return ACESSO.url;
}

async function servidor(acao, dados = {}) {
  const url = urlServidor();
  let r;
  if (url === "simulado") {
    if (!window.SimuladorAcesso) {
      await new Promise((ok, falhou) => {
        const s = document.createElement("script");
        s.src = "simulador-acesso.js"; s.onload = ok; s.onerror = falhou;
        document.head.appendChild(s);
      });
    }
    r = await window.SimuladorAcesso.chamar({ acao, ...dados });
  } else {
    // text/plain evita a "pré-consulta" CORS, que o Apps Script não responde.
    const resp = await fetch(url, { method: "POST", body: JSON.stringify({ acao, ...dados }) });
    if (!resp.ok) throw new Error("Servidor indisponível. Tente de novo em instantes.");
    r = await resp.json();
  }
  if (!r.ok) {
    if (r.erro === "SESSAO_INVALIDA") { sessaoCaiu(); throw new Error("Sua sessão terminou. Entre de novo."); }
    throw new Error(r.erro);
  }
  return r.dados;
}
const api = (nome, ...args) => servidor("api", { nome, sessao: Acesso.sessao, args });

// ----------------------------------------------------------------- telas --
function mostrarPortaria(modo = "entrar") {
  document.body.classList.add("bloqueado");
  $a("portaria").hidden = false;
  trocarModo(modo);
}

function trocarModo(modo) {
  const entrar = modo === "entrar";
  $a("form-entrar").hidden = !entrar;
  $a("form-codigo").hidden = entrar;
  limparMsgs();
  if (entrar) { setTimeout(() => $a("entrar-email").focus(), 0); return; }
  const primeiro = modo === "primeiro";
  $a("codigo-titulo").textContent = primeiro ? "Primeiro acesso" : "Esqueci a senha";
  $a("codigo-explica").textContent = primeiro
    ? "Digite o e-mail cadastrado pelo administrador. Você vai receber um código para criar sua senha."
    : "Digite seu e-mail. Você vai receber um código para criar uma senha nova.";
  $a("codigo-email").value = $a("entrar-email").value;
  $a("codigo-email").readOnly = false;
  $a("codigo-passo2").hidden = true;
  $a("codigo-reenviar").hidden = true;
  $a("codigo-botao").textContent = "Enviar código";
  ["codigo-codigo", "codigo-senha", "codigo-senha2"].forEach((id) => ($a(id).value = ""));
  setTimeout(() => $a("codigo-email").focus(), 0);
}

function limparMsgs() { document.querySelectorAll(".msg").forEach((m) => { m.textContent = ""; m.className = "msg"; }); }
function msg(form, texto, tipo = "erro") { const m = form.querySelector(".msg"); m.textContent = texto; m.className = `msg msg-${tipo}`; }

// Desativa o botão enquanto o servidor responde (o Google às vezes leva vários segundos).
async function ocupado(botao, fn, espera = "Aguarde…") {
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = espera;
  try { return await fn(); } finally { botao.disabled = false; botao.textContent = rotulo; }
}

function entrou(dados) {
  gravarSessao(dados.sessao);
  mostrarPerfil(dados.perfil);
}

function mostrarPerfil(perfil) {
  Acesso.perfil = perfil;
  $a("usuario-nome").textContent = perfil.nome;
  $a("usuario-nome").title = perfil.email;
  $a("btn-admin").hidden = !perfil.admin;
  $a("portaria").hidden = true;
  document.body.classList.remove("bloqueado");
  iniciarPainel();
}

function sessaoCaiu() {
  gravarSessao(null);
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  mostrarPortaria("entrar");
  msg($a("form-entrar"), "Sua sessão terminou. Entre de novo.", "info");
}

// ------------------------------------------------------- entrar / código --
$a("form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, email = $a("entrar-email").value.trim(), senha = $a("entrar-senha").value;
  if (!email || !senha) return msg(form, "Digite e-mail e senha.");
  try {
    await ocupado(form.querySelector("button[type=submit]"), async () => entrou(await servidor("entrar", { email, senha })), "Entrando…");
    $a("entrar-senha").value = "";
  } catch (e) { msg(form, e.message); }
});

document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => trocarModo(b.dataset.modo)));

async function enviarCodigo() {
  const form = $a("form-codigo"), email = $a("codigo-email").value.trim();
  if (!email) return msg(form, "Digite seu e-mail.");
  await servidor("pedirCodigo", { email });
  $a("codigo-email").readOnly = true;
  $a("codigo-passo2").hidden = false;
  $a("codigo-reenviar").hidden = false;
  msg(form, `Enviamos um código para ${email}. Ele vale por 15 minutos (confira também o spam).`, "ok");
  $a("codigo-codigo").focus();
}

$a("form-codigo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, botao = $a("codigo-botao");
  try {
    if ($a("codigo-passo2").hidden) {
      await ocupado(botao, enviarCodigo, "Enviando código…");
      // Só depois de ocupado() devolver o rótulo antigo: senão o botão voltaria a dizer "Enviar código".
      botao.textContent = "Salvar senha e entrar";
      return;
    }
    const codigo = $a("codigo-codigo").value.replace(/\D/g, ""), senha = $a("codigo-senha").value;
    if (codigo.length !== 6) return msg(form, "Digite o código de 6 dígitos que chegou por e-mail.");
    if (senha !== $a("codigo-senha2").value) return msg(form, "As duas senhas não estão iguais.");
    msg(form, "Salvando sua senha. Isso pode levar alguns segundos…", "info");
    await ocupado(botao, async () => entrou(await servidor("definirSenha", { email: $a("codigo-email").value.trim(), codigo, senha })), "Salvando…");
  } catch (e) { msg(form, e.message); }
});

$a("codigo-reenviar").addEventListener("click", async (ev) => {
  try { await ocupado(ev.currentTarget, enviarCodigo, "Enviando…"); } catch (e) { msg($a("form-codigo"), e.message); }
});

$a("btn-sair").addEventListener("click", async () => {
  const s = Acesso.sessao;
  gravarSessao(null);
  try { await servidor("sair", { sessao: s }); } catch { /* sai do mesmo jeito */ }
  location.reload();
});

// ----------------------------------------------------------- diálogos --
document.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

function confirmar(texto, rotulo = "Confirmar") {
  const dlg = $a("dlg-confirmar");
  $a("dlg-confirmar-texto").textContent = texto;
  dlg.querySelector("[value=sim]").textContent = rotulo;
  return new Promise((ok) => {
    const responder = (v) => () => { dlg.close(); ok(v); };
    dlg.querySelector("[value=sim]").onclick = responder(true);
    dlg.querySelector("[value=nao]").onclick = responder(false);
    dlg.oncancel = responder(false);
    dlg.showModal();
    dlg.querySelector("[value=nao]").focus(); // ação destrutiva: o foco fica em Cancelar
  });
}

$a("btn-senha").addEventListener("click", () => {
  limparMsgs();
  ["senha-atual", "senha-nova", "senha-nova2"].forEach((id) => ($a(id).value = ""));
  $a("dlg-senha").showModal();
});

$a("form-senha").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, nova = $a("senha-nova").value;
  if (nova !== $a("senha-nova2").value) return msg(form, "As duas senhas novas não estão iguais.");
  try {
    await ocupado(form.querySelector("button[type=submit]"), async () => {
      const r = await api("alterarSenha", $a("senha-atual").value, nova);
      gravarSessao(r.sessao);
    });
    msg(form, "Senha alterada.", "ok");
    setTimeout(() => $a("dlg-senha").close(), 900);
  } catch (e) { msg(form, e.message); }
});

// ------------------------------------------------------- administrador --
const ROTULO_ACAO = {
  entrada: "Entrou", acesso: "Abriu o Radar", entrada_recusada: "Tentativa de quem não é da equipe",
  senha_errada: "Senha errada", senha_criada: "Criou a senha", senha_redefinida: "Trocou a senha (código)",
  senha_alterada: "Trocou a senha", senha_apagada: "Senha apagada pelo administrador", codigo_enviado: "Pediu código",
  membro_cadastrado: "Cadastrou pessoa", membro_alterado: "Alterou pessoa", membro_removido: "Removeu pessoa",
  boasvindas_enviado: "Enviou boas-vindas",
};

function dataCurta(t) {
  if (!t) return "—";
  const [d, h] = String(t).split(" ");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h ? " " + h.slice(0, 5) : ""}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$a("btn-admin").addEventListener("click", async () => {
  limparMsgs();
  trocarAba("equipe");
  $a("dlg-admin").showModal();
  await carregarEquipe();
});

document.querySelectorAll("#dlg-admin .aba").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
async function trocarAba(aba) {
  document.querySelectorAll("#dlg-admin .aba").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
  $a("aba-equipe").hidden = aba !== "equipe";
  $a("aba-registro").hidden = aba !== "registro";
  if (aba === "registro") {
    const corpo = $a("registro-corpo");
    corpo.innerHTML = `<tr><td colspan="3" class="carregando">Carregando…</td></tr>`;
    try {
      const linhas = await api("registro");
      corpo.innerHTML = linhas.length ? linhas.map((r) => `<tr><td class="nowrap">${dataCurta(r.quando)}</td><td>${esc(r.quem)}</td>` +
        `<td>${esc(ROTULO_ACAO[r.acao] || r.acao)}${r.detalhe ? `<div class="detalhe">${esc(r.detalhe)}</div>` : ""}</td></tr>`).join("")
        : `<tr><td colspan="3" class="carregando">Nada registrado ainda.</td></tr>`;
    } catch (e) { corpo.innerHTML = `<tr><td colspan="3" class="erro">${esc(e.message)}</td></tr>`; }
  }
}

async function carregarEquipe(lista) {
  const corpo = $a("equipe-corpo");
  if (!lista) {
    corpo.innerHTML = `<tr><td colspan="4" class="carregando">Carregando…</td></tr>`;
    try { lista = await api("equipe"); } catch (e) { corpo.innerHTML = `<tr><td colspan="4" class="erro">${esc(e.message)}</td></tr>`; return; }
  }
  corpo.innerHTML = lista.map((p) => {
    const eu = Acesso.perfil && p.email === Acesso.perfil.email;
    const situacao = p.tem_senha ? `<span class="ok">Ativa</span>` : `<span class="pendente">Ainda não criou a senha</span>`;
    return `<tr data-email="${esc(p.email)}">
      <td><strong>${esc(p.nome)}</strong>${p.admin ? ' <span class="selo">admin</span>' : ""}${eu ? ' <span class="selo selo-eu">você</span>' : ""}
        <div class="detalhe">${esc(p.email)}</div></td>
      <td>${situacao}${p.boasvindas_em ? `<div class="detalhe">Boas-vindas em ${dataCurta(p.boasvindas_em)}</div>` : ""}</td>
      <td class="nowrap">${dataCurta(p.ultimo_acesso)}</td>
      <td><div class="acoes-linha">
        <button type="button" class="link" data-acao="admin">${p.admin ? "Tirar admin" : "Tornar admin"}</button>
        <button type="button" class="link" data-acao="boasvindas">Reenviar boas-vindas</button>
        ${p.tem_senha && !eu ? '<button type="button" class="link" data-acao="apagarSenha">Apagar senha</button>' : ""}
        ${eu ? "" : '<button type="button" class="link perigo" data-acao="remover">Remover</button>'}
      </div></td></tr>`;
  }).join("") || `<tr><td colspan="4" class="carregando">Ninguém cadastrado.</td></tr>`;
  corpo.querySelectorAll("[data-acao]").forEach((b) => b.addEventListener("click", () => acaoMembro(b, lista)));
}

async function acaoMembro(botao, lista) {
  const email = botao.closest("tr").dataset.email, p = lista.find((x) => x.email === email), form = $a("form-membro");
  const perguntas = {
    remover: [`Remover ${p.nome} do Radar? A pessoa perde o acesso na hora.`, "Remover"],
    apagarSenha: [`Apagar a senha de ${p.nome}? A pessoa sai de todos os navegadores e precisa fazer o "Primeiro acesso" de novo.`, "Apagar senha"],
  };
  const acao = botao.dataset.acao;
  if (perguntas[acao] && !(await confirmar(...perguntas[acao]))) return;
  try {
    let nova;
    await ocupado(botao, async () => {
      if (acao === "admin") nova = await api("salvarMembro", p.email, p.nome, !p.admin, false);
      if (acao === "boasvindas") nova = await api("enviarBoasVindas", p.email);
      if (acao === "apagarSenha") nova = await api("apagarSenha", p.email);
      if (acao === "remover") nova = await api("removerMembro", p.email);
    });
    const feito = { admin: "Perfil atualizado.", boasvindas: `Boas-vindas enviado para ${p.email}.`, apagarSenha: "Senha apagada.", remover: `${p.nome} foi removido(a).` };
    msg(form, feito[acao], "ok");
    carregarEquipe(nova);
  } catch (e) { msg(form, e.message); }
}

$a("form-membro").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, nome = $a("membro-nome").value.trim(), email = $a("membro-email").value.trim();
  if (!nome || !email) return msg(form, "Preencha nome e e-mail.");
  try {
    const boas = $a("membro-boasvindas").checked;
    const lista = await ocupado(form.querySelector("button[type=submit]"),
      () => api("salvarMembro", email, nome, $a("membro-admin").checked, boas));
    msg(form, `${nome} cadastrado(a).` + (boas ? " O e-mail de boas-vindas foi enviado." : ""), "ok");
    $a("membro-nome").value = ""; $a("membro-email").value = ""; $a("membro-admin").checked = false;
    carregarEquipe(lista);
  } catch (e) { msg(form, e.message); }
});

// ---------------------------------------------------------------- início --
(async function iniciarAcesso() {
  if (!urlServidor()) {
    mostrarPortaria("entrar");
    $a("form-entrar").hidden = true;
    const aviso = $a("portaria-aviso");
    aviso.hidden = false;
    aviso.textContent = "O acesso ao Radar ainda não foi configurado. Fale com o administrador do sistema.";
    return;
  }
  const s = lerSessao();
  if (!s) return mostrarPortaria("entrar");
  Acesso.sessao = s;
  try { mostrarPerfil(await api("perfil")); }
  catch (e) {
    if (Acesso.sessao) { mostrarPortaria("entrar"); msg($a("form-entrar"), e.message); }
  }
})();
