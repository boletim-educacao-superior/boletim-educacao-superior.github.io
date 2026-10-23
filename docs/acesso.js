// Entrada no Radar: e-mail e senha, primeiro acesso / esqueci a senha (código por e-mail),
// troca de senha e área do administrador. Conversa com o servidor de acesso (acesso/Acesso.gs, Apps Script).
//
// O painel é ABERTO (pedido do Diego, 23/10/2026): qualquer pessoa vê as notícias. Entrar serve para a equipe
// do CINEA sinalizar, marcar sem relevância ou lida, ver as áreas da equipe e (admins) administrar.

const VERSAO_ACESSO = "20261023214251"; // carimbado por ferramentas/versao.py

/**
 * O navegador guarda cada arquivo por 10 minutos, separadamente. Se a página e os scripts vierem de
 * publicações diferentes, recarrega uma vez buscando tudo de novo (o ?r= força o index.html novo).
 * Devolve true se vai recarregar.
 */
function conferirVersao() {
  const esperada = window.RADAR_VERSAO, app = typeof VERSAO_APP === "undefined" ? null : VERSAO_APP;
  if (esperada === VERSAO_ACESSO && esperada === app) return false;
  let tentou = false;
  try { tentou = sessionStorage.getItem("radar.recarregou") === esperada; sessionStorage.setItem("radar.recarregou", esperada); } catch { /* sem sessionStorage */ }
  if (tentou) return false; // já tentou uma vez: segue com o que tem, para não ficar recarregando sem parar
  const u = new URL(location.href);
  u.searchParams.set("r", Date.now().toString(36));
  location.replace(u.toString());
  return true;
}

const ACESSO = {
  // Endereço do App da Web do Apps Script (termina em /exec). Ver acesso/README.md.
  url: "https://script.google.com/macros/s/AKfycbxgKFOecHcd4-nfNhmtiZbPWP8F9J4AX2Y5Wjm6iJDDXgfig6tNl6zcC7sb4lSmS-3Q/exec",
};

const CHAVE_SESSAO = "radar.sessao";
const Acesso = { sessao: null, perfil: null };
const $a = (id) => document.getElementById(id);

// ------------------------------------------------------------------ tema --
// Como no sistema de certificados: abre sempre no claro; quem escolher o escuro, fica com ele neste navegador.
const ICONE_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICONE_LUA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const temaAtual = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "escuro" : "claro");
function aplicarTema(tema, salvar) {
  document.documentElement.setAttribute("data-theme", tema === "escuro" ? "dark" : "light");
  if (salvar) { try { localStorage.setItem("radar.tema", tema); } catch { /* modo privado */ } }
  const rotulo = tema === "escuro" ? "Usar tema claro" : "Usar tema escuro";
  document.querySelectorAll(".alternar-tema").forEach((b) => {
    b.innerHTML = tema === "escuro" ? ICONE_SOL : ICONE_LUA;
    b.title = rotulo; b.setAttribute("aria-label", rotulo);
  });
}
aplicarTema(temaAtual(), false);
document.addEventListener("click", (e) => {
  if (e.target.closest?.(".alternar-tema")) aplicarTema(temaAtual() === "escuro" ? "claro" : "escuro", true);
});

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

/**
 * O Apps Script às vezes responde com uma página de erro do Google em vez de JSON (por alguns segundos
 * depois de uma publicação, ou num soluço da rede). Tenta de novo uma vez antes de desistir.
 */
async function chamarGoogle(url, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      // text/plain evita a "pré-consulta" CORS, que o Apps Script não responde.
      const resp = await fetch(url, { method: "POST", body: JSON.stringify(corpo) });
      const texto = await resp.text();
      if (resp.ok) return JSON.parse(texto);
    } catch { /* rede ou resposta que não é JSON: tenta de novo */ }
    if (tentativa >= 2) throw new Error("O servidor do Google não respondeu direito. Tente de novo em alguns segundos.");
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}

async function servidor(acao, dados = {}) {
  const url = urlServidor();
  let r;
  if (url === "simulado") {
    if (!window.SimuladorAcesso) {
      await new Promise((ok, falhou) => {
        const s = document.createElement("script");
        s.src = `simulador-acesso.js?v=${VERSAO_ACESSO}`; s.onload = ok; s.onerror = falhou;
        document.head.appendChild(s);
      });
    }
    r = await window.SimuladorAcesso.chamar({ acao, ...dados });
  } else {
    // text/plain evita a "pré-consulta" CORS, que o Apps Script não responde.
    r = await chamarGoogle(url, { acao, ...dados });
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
  // Com o painel aberto ao público, a tela de entrada pode ser fechada para voltar às notícias.
  $a("portaria-fechar").hidden = !painelIniciado;
  trocarModo(modo);
}
function fecharPortaria() {
  $a("portaria").hidden = true;
  document.body.classList.remove("bloqueado");
}

/** Leva à tela de entrada explicando o motivo ("Para sinalizar, você precisa estar logado."). */
function pedirLogin(motivo) {
  mostrarPortaria("entrar");
  if (motivo) msg($a("form-entrar"), motivo, "info");
}

/** Visitante sem login: vê as notícias; ações e áreas da equipe pedem login. */
function abrirPublico() {
  Acesso.perfil = null;
  document.body.classList.add("visitante");
  fecharPortaria();
  iniciarPainel();
}

function trocarModo(modo) {
  const entrar = modo === "entrar";
  $a("form-entrar").hidden = !entrar;
  $a("form-codigo").hidden = entrar;
  limparMsgs();
  if (entrar) { setTimeout(() => $a("entrar-email").focus(), 0); return; }
  modoCodigo = modo;
  const textos = {
    primeiro: ["Primeiro acesso", "Digite o e-mail cadastrado pelo administrador. Você vai receber um código para criar sua senha."],
    esqueci: ["Esqueci a senha", "Digite seu e-mail. Você vai receber um código para criar uma senha nova."],
    cadastro: ["Criar minha conta", "Digite seu nome e e-mail. Você vai receber um código para confirmar o e-mail e criar sua senha."],
  }[modo];
  $a("codigo-titulo").textContent = textos[0];
  $a("codigo-explica").textContent = textos[1];
  $a("codigo-nome-rot").hidden = modo !== "cadastro";
  $a("codigo-nome").readOnly = false;
  $a("codigo-email").value = $a("entrar-email").value;
  $a("codigo-email").readOnly = false;
  $a("codigo-passo2").hidden = true;
  $a("codigo-reenviar").hidden = true;
  $a("codigo-botao").textContent = "Enviar código";
  ["codigo-codigo", "codigo-senha", "codigo-senha2"].forEach((id) => ($a(id).value = ""));
  setTimeout(() => $a(modo === "cadastro" ? "codigo-nome" : "codigo-email").focus(), 0);
}
let modoCodigo = "primeiro";

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
  // Recarrega para trazer as marcações da equipe e as áreas de quem entrou (o painel já pode estar aberto como visitante).
  if (painelIniciado) { location.reload(); return; }
  mostrarPerfil(dados.perfil);
}

// Sigla do nome, como no sistema de certificados: primeira e última palavra que contam ("Diego Eduardo" → DE).
const iniciais = (n) => String(n || "").split(" ").filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
  .filter((p) => !/^(de|da|do|dos|das|e)$/i.test(p))
  .map((p) => p[0]).filter((c, i, a) => i === 0 || i === a.length - 1).join("").toUpperCase() || "?";
const ROTULO_PERFIL = (p) => (p.admin ? "Administrador" : p.tipo === "usuario" ? "Usuário" : "Equipe CINEA");
const ehUsuario = () => Acesso.perfil?.tipo === "usuario";

function preencherConta(perfil) {
  Acesso.perfil = perfil;
  $a("usuario-nome").textContent = perfil.nome;
  $a("usuario-nome").title = `Meu perfil (${perfil.email})`;
  const tag = $a("perfil-topo");
  tag.textContent = ROTULO_PERFIL(perfil);
  tag.dataset.perfil = perfil.admin ? "admin" : perfil.tipo === "usuario" ? "usuario" : "equipe";
  document.body.classList.toggle("perfil-usuario", perfil.tipo === "usuario");
  $a("sigla-topo").textContent = iniciais(perfil.nome || perfil.email);
  $a("sigla-topo").title = `${perfil.nome} · Meu perfil`;
}

function mostrarPerfil(perfil) {
  preencherConta(perfil);
  document.body.classList.remove("visitante");
  fecharPortaria();
  iniciarPainel();
}

function sessaoCaiu() {
  gravarSessao(null);
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  // Volta a ser visitante: continua vendo as notícias e pode entrar de novo.
  if (painelIniciado) { location.reload(); return; }
  abrirPublico();
}

$a("btn-entrar").addEventListener("click", () => pedirLogin(""));
$a("btn-criar-conta").addEventListener("click", () => { mostrarPortaria("entrar"); trocarModo("cadastro"); });
$a("portaria-fechar").addEventListener("click", fecharPortaria);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$a("portaria").hidden && painelIniciado) fecharPortaria(); });

// ------------------------------------------------------- entrar / código --
$a("form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, email = $a("entrar-email").value.trim(), senha = $a("entrar-senha").value;
  if (!email || !senha) return msg(form, "Digite e-mail e senha.");
  try {
    await ocupado(form.querySelector("button[type=submit]"), async () => entrou(await servidor("entrar", { email, senha })), "Entrando…");
    $a("entrar-senha").value = "";
  } catch (e) {
    // Quem ainda não criou a senha vai direto para o primeiro acesso, com o e-mail preenchido.
    if (/ainda não criou sua senha/.test(e.message)) {
      trocarModo("primeiro");
      msg($a("form-codigo"), "Este e-mail ainda não tem senha. Clique em \"Enviar código\" para criar a sua.", "info");
      return;
    }
    msg(form, e.message);
  }
});

document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => trocarModo(b.dataset.modo)));

async function enviarCodigo() {
  const form = $a("form-codigo"), email = $a("codigo-email").value.trim();
  if (modoCodigo === "cadastro" && $a("codigo-nome").value.trim().length < 3) return msg(form, "Digite seu nome.");
  if (!email) return msg(form, "Digite seu e-mail.");
  // Criar conta: o servidor cadastra (perfil Usuário) e manda o código; nos outros casos, só manda o código.
  if (modoCodigo === "cadastro") await servidor("cadastrar", { nome: $a("codigo-nome").value.trim(), email });
  else await servidor("pedirCodigo", { email });
  $a("codigo-email").readOnly = true;
  $a("codigo-nome").readOnly = true;
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

async function sair() {
  const s = Acesso.sessao;
  gravarSessao(null);
  try { await servidor("sair", { sessao: s }); } catch { /* sai do mesmo jeito */ }
  location.reload();
}
$a("link-sair").addEventListener("click", sair);

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

function abrirSenha() {
  limparMsgs();
  ["senha-atual", "senha-nova", "senha-nova2"].forEach((id) => ($a(id).value = ""));
  $a("dlg-senha").showModal();
}

// ------------------------------------------------------------ meu perfil --
async function abrirPerfil() {
  limparMsgs();
  const dlg = $a("dlg-perfil");
  const mostrar = (p) => {
    $a("mp-sigla").textContent = iniciais(p.nome || p.email);
    $a("mp-titulo").textContent = p.nome;
    $a("mp-email-topo").textContent = p.email;
    const tag = $a("mp-perfil-tag");
    tag.textContent = ROTULO_PERFIL(p); tag.dataset.perfil = p.admin ? "admin" : "equipe";
    $a("mp-nome").value = p.nome; $a("mp-nome").readOnly = !!p.sistema;
    $a("mp-email").value = p.email;
    $a("mp-desde").value = p.cadastrado_em ? dataCurta(p.cadastrado_em).slice(0, 10) : "—";
    $a("mp-por").value = p.cadastrado_por === "cineaned@gmail.com" ? "Conta do sistema" : p.cadastrado_por || "—";
    $a("mp-por").title = p.cadastrado_por || "";
    $a("mp-senha-em").value = p.senha_em ? dataCurta(p.senha_em).slice(0, 10) : "—";
    $a("mp-salvar").disabled = true;
  };
  mostrar(Acesso.perfil);
  dlg.showModal();
  try { const p = await api("perfil"); preencherConta(p); mostrar(p); } catch (e) { msg($a("form-perfil"), e.message); }
}
$a("mp-nome").addEventListener("input", () => {
  const v = $a("mp-nome").value.replace(/\s+/g, " ").trim();
  $a("mp-salvar").disabled = !v || v === Acesso.perfil.nome;
});
$a("form-perfil").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  try {
    const p = await ocupado($a("mp-salvar"), () => api("salvarMeuNome", $a("mp-nome").value), "Salvando…");
    preencherConta(p);
    $a("mp-titulo").textContent = p.nome;
    $a("mp-sigla").textContent = iniciais(p.nome);
    $a("mp-salvar").disabled = true;
    msg(form, "Nome atualizado.", "ok");
  } catch (e) { msg(form, e.message); }
});
$a("mp-trocar-senha").addEventListener("click", () => { $a("dlg-perfil").close(); abrirSenha(); });
$a("usuario-nome").addEventListener("click", abrirPerfil);
$a("sigla-topo").addEventListener("click", abrirPerfil);

// ------------------------------------------------- engrenagem (menu) --
// Mesmo comportamento da engrenagem dos certificados: lista o que o perfil da pessoa pode ver.
function fecharMenu() {
  document.querySelectorAll(".menu-lista").forEach((m) => m.remove());
  $a("botao-engrenagem").setAttribute("aria-expanded", "false");
}
$a("botao-engrenagem").addEventListener("click", (ev) => {
  ev.stopPropagation();
  const g = $a("botao-engrenagem"), jaAberto = g.getAttribute("aria-expanded") === "true";
  fecharMenu();
  if (jaAberto) return;
  const p = Acesso.perfil || {};
  const itens = [
    ["perfil", "Meu perfil"], ["senha", "Alterar senha"],
    p.admin && ["hr"], p.admin && ["admin", "Administrador"], p.admin && ["uso", "Uso da plataforma"],
    p.admin && ["registro", "Registro de atividades"],
    ["hr"], ["sair", "Sair"],
  ].filter(Boolean);
  const m = document.createElement("div");
  m.className = "menu-lista"; m.setAttribute("role", "menu");
  m.innerHTML = `<div class="menu-cab"><b>${esc(p.nome)}</b><span>${esc(p.email)}</span></div>` +
    itens.map(([a, t]) => (a === "hr" ? "<hr>" : `<button type="button" role="menuitem" data-ir="${a}">${esc(t)}</button>`)).join("");
  document.body.appendChild(m);
  const r = g.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = r.bottom + 6 + "px";
  g.setAttribute("aria-expanded", "true");
  m.querySelector("button").focus();
  m.onclick = (e) => {
    const b = e.target.closest("[data-ir]");
    if (!b) return;
    fecharMenu();
    ({ perfil: abrirPerfil, senha: abrirSenha, admin: () => irParaAdmin(""), uso: () => irParaAdmin("uso"), registro: () => irParaAdmin("registro"), sair })[b.dataset.ir]();
  };
  m.onkeydown = (e) => {
    const bs = [...m.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    if (e.key === "Escape") { fecharMenu(); g.focus(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length].focus(); }
  };
});
document.addEventListener("click", (ev) => { if (!ev.target.closest(".menu-lista")) fecharMenu(); });
window.addEventListener("resize", fecharMenu);
document.addEventListener("scroll", fecharMenu, true);

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
  entrada: "Entrou", acesso: "Abriu o Boletim", entrada_recusada: "Tentativa de quem não é da equipe",
  senha_errada: "Senha errada", senha_criada: "Criou a senha", senha_redefinida: "Trocou a senha (código)",
  senha_alterada: "Trocou a senha", senha_apagada: "Senha apagada pelo administrador", codigo_enviado: "Pediu código",
  membro_cadastrado: "Cadastrou pessoa", membro_alterado: "Alterou pessoa", membro_removido: "Removeu pessoa",
  boasvindas_enviado: "Enviou boas-vindas", nome_alterado: "Trocou o próprio nome",
  item_sinalizada: "Sinalizou notícia", item_sinalizada_desfeito: "Tirou a sinalização",
  item_irrelevante: "Marcou como sem relevância", item_irrelevante_desfeito: "Desfez “sem relevância”",
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

// Página do Administrador (endereço #admin). app.js chama abrirPaginaAdmin() quando o endereço muda.
// destino: "" (topo), "uso" (Uso da plataforma) ou "registro" (Registro de atividades).
function irParaAdmin(destino) {
  if (destino === "registro") $a("sanfona-registro").open = true;
  if (location.hash === "#admin") abrirPaginaAdmin(destino);
  else { irParaSecao = destino; location.hash = "#admin"; }
}
let irParaSecao = "";

function abrirPaginaAdmin(destino = irParaSecao) {
  irParaSecao = "";
  limparMsgs();
  carregarUso();
  carregarEquipe();
  if ($a("sanfona-registro").open) carregarRegistro();
  const alvo = { uso: "secao-uso", registro: "sanfona-registro" }[destino];
  if (alvo) setTimeout(() => $a(alvo).scrollIntoView({ block: "start" }), 0);
  else window.scrollTo(0, 0);
}
$a("sanfona-registro").addEventListener("toggle", () => { if ($a("sanfona-registro").open) carregarRegistro(); });

async function carregarRegistro() {
  const corpo = $a("registro-corpo");
  corpo.innerHTML = `<tr><td colspan="3" class="carregando">Carregando…</td></tr>`;
  try {
    const linhas = await api("registro");
    corpo.innerHTML = linhas.length ? linhas.map((r) => `<tr><td class="nowrap">${dataCurta(r.quando)}</td><td>${esc(r.quem)}</td>` +
      `<td>${esc(ROTULO_ACAO[r.acao] || r.acao)}${r.detalhe ? `<div class="detalhe">${esc(r.detalhe)}</div>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="3" class="carregando">Nada registrado ainda.</td></tr>`;
  } catch (e) { corpo.innerHTML = `<tr><td colspan="3" class="erro">${esc(e.message)}</td></tr>`; }
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
      <td><strong>${esc(p.nome)}</strong>${p.admin ? ' <span class="selo">admin</span>' : ""}${p.perfil === "usuario" ? ' <span class="selo selo-usuario" title="Criou a própria conta: marcações só dele(a)">usuário</span>' : ""}${eu ? ' <span class="selo selo-eu">você</span>' : ""}
        <div class="detalhe">${esc(p.email)}</div></td>
      <td>${situacao}${p.boasvindas_em ? `<div class="detalhe">Boas-vindas em ${dataCurta(p.boasvindas_em)}</div>` : ""}</td>
      <td class="nowrap">${dataCurta(p.ultimo_acesso)}</td>
      <td><div class="acoes-linha">
        ${p.perfil === "usuario"
          ? '<button type="button" class="link" data-acao="promover" title="Passa a marcar notícias para toda a equipe">Tornar equipe CINEA</button>'
          : `<button type="button" class="link" data-acao="admin">${p.admin ? "Tirar admin" : "Tornar admin"}</button>`}
        ${p.perfil !== "usuario" && !p.admin && !eu ? '<button type="button" class="link" data-acao="rebaixar">Tornar usuário</button>' : ""}
        <button type="button" class="link" data-acao="boasvindas">Reenviar boas-vindas</button>
        ${p.tem_senha && !eu ? '<button type="button" class="link" data-acao="apagarSenha">Apagar senha</button>' : ""}
        ${eu ? "" : '<button type="button" class="link perigo" data-acao="remover">Remover</button>'}
      </div></td></tr>`;
  }).join("") || `<tr><td colspan="4" class="carregando">Ninguém cadastrado.</td></tr>`;
  const semSenha = lista.filter((p) => !p.tem_senha).length, usuarios = lista.filter((p) => p.perfil === "usuario").length;
  $a("equipe-conta").textContent = `· ${lista.length - usuarios} da equipe CINEA · ${usuarios} usuário(s) cadastrado(s)` +
    (semSenha ? ` · ${semSenha} ainda sem senha` : "");
  corpo.querySelectorAll("[data-acao]").forEach((b) => b.addEventListener("click", () => acaoMembro(b, lista)));
}

async function acaoMembro(botao, lista) {
  const email = botao.closest("tr").dataset.email, p = lista.find((x) => x.email === email), form = $a("form-membro");
  const perguntas = {
    remover: [`Remover ${p.nome} do Boletim? A pessoa perde o acesso na hora.`, "Remover"],
    apagarSenha: [`Apagar a senha de ${p.nome}? A pessoa sai de todos os navegadores e precisa fazer o "Primeiro acesso" de novo.`, "Apagar senha"],
  };
  const acao = botao.dataset.acao;
  if (perguntas[acao] && !(await confirmar(...perguntas[acao]))) return;
  try {
    let nova;
    await ocupado(botao, async () => {
      if (acao === "admin") nova = await api("salvarMembro", p.email, p.nome, !p.admin, false);
      if (acao === "promover") nova = await api("salvarMembro", p.email, p.nome, false, false, "equipe");
      if (acao === "rebaixar") nova = await api("salvarMembro", p.email, p.nome, false, false, "usuario");
      if (acao === "boasvindas") nova = await api("enviarBoasVindas", p.email);
      if (acao === "apagarSenha") nova = await api("apagarSenha", p.email);
      if (acao === "remover") nova = await api("removerMembro", p.email);
    });
    const feito = { promover: `${p.nome} agora é da equipe do CINEA.`, rebaixar: `${p.nome} agora tem perfil de usuário.`, admin: "Perfil atualizado.", boasvindas: `Boas-vindas enviado para ${p.email}.`, apagarSenha: "Senha apagada.", remover: `${p.nome} foi removido(a).` };
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
// Começa só depois de todos os scripts da página (app.js inclusive) terem carregado.
document.addEventListener("DOMContentLoaded", async function iniciarAcesso() {
  if (conferirVersao()) return;
  if (!urlServidor()) {
    mostrarPortaria("entrar");
    $a("form-entrar").hidden = true;
    const aviso = $a("portaria-aviso");
    aviso.hidden = false;
    aviso.textContent = "O acesso ao Boletim ainda não foi configurado. Fale com o administrador do sistema.";
    return;
  }
  const s = lerSessao();
  if (!s) return abrirPublico();
  Acesso.sessao = s;
  try { mostrarPerfil(await api("perfil")); }
  catch (e) {
    // Sessão vencida ou servidor fora do ar: segue como visitante (as notícias continuam visíveis).
    if (Acesso.sessao) gravarSessao(null);
    abrirPublico();
    aviso("Sua sessão terminou: você está vendo o painel como visitante. Use \"Entrar\" para marcar notícias.");
  }
});

// ------------------------------------------------------- uso da plataforma --
// Relatório dos administradores: mapa de calor (dia da semana × hora), acessos por dia (equipe e visitantes)
// e o que mais se abre e busca. Escala de uma cor só (claro → escuro) no mapa; legenda e números sempre visíveis.
const DIAS_SEMANA = [["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6], ["Dom", 0]];
const NOME_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const NOME_VISAO = { inicio: "Início", sinalizadas: "Sinalizadas", "nao-lidas": "Não lidas", lidas: "Lidas",
                     "sem-relevancia": "Sem relevância", admin: "Administrador" };

$a("uso-periodo").addEventListener("change", () => carregarUso());

async function carregarUso() {
  const caixa = $a("uso-conteudo");
  caixa.innerHTML = '<p class="carregando">Carregando…</p>';
  try { caixa.innerHTML = montarUso(await api("uso", Number($a("uso-periodo").value))); ligarDicas(caixa); }
  catch (e) { caixa.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}

function montarUso(u) {
  if (!u.aberturas) {
    return '<p class="vazio">Nenhum acesso registrado neste período. O registro começou em 23/10/2026; os acessos aparecem aqui conforme o painel for usado.</p>';
  }
  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  // Pico: a célula mais cheia do mapa
  let pico = { n: 0 };
  u.calor.forEach((horas, d) => horas.forEach((n, h) => { if (n > pico.n) pico = { n, d, h }; }));
  const cartoes = [
    [u.aberturas, "Acessos ao painel", `${u.dias === 7 ? "nos últimos 7 dias" : `nos últimos ${u.dias} dias`}`],
    [u.visitantes, "Navegadores diferentes", "cada navegador conta uma vez"],
    [u.aberturas_equipe, "Acessos da equipe", `${u.pessoas_equipe} pessoa(s) com login · ${pct(u.aberturas_equipe, u.aberturas)}%`],
    [u.aberturas_usuarios, "Acessos de usuários", `${u.pessoas_usuarios} usuário(s) com conta própria · ${pct(u.aberturas_usuarios, u.aberturas)}%`],
    [u.aberturas_publico, "Acessos de visitantes", `sem login · ${pct(u.aberturas_publico, u.aberturas)}%`],
    [u.cadastros_novos, "Contas criadas", `no período · ${u.total_usuarios} usuário(s) no total`],
    [u.noticias_abertas, "Notícias abertas", u.csv ? `${u.csv} exportação(ões) para Excel` : "cliques no título"],
    [`${pct(u.dispositivos.celular, u.aberturas)}%`, "Pelo celular", `${u.dispositivos.celular} de ${u.aberturas} acessos`],
  ];
  return `
    <div class="uso-cartoes">${cartoes.map(([n, r, d]) =>
      `<div class="uso-cartao"><span class="num">${esc(n)}</span><span class="rot">${esc(r)}</span><span class="det">${esc(d)}</span></div>`).join("")}</div>
    ${pico.n ? `<p class="uso-pico">Horário de maior uso: <b>${NOME_DIA[pico.d]}, das ${pico.h}h às ${pico.h + 1}h</b> (${pico.n} acesso${pico.n > 1 ? "s" : ""}).</p>` : ""}
    <div class="uso-bloco">
      <h4>Quando o painel é acessado <span class="meta">dia da semana × hora</span></h4>
      ${mapaDeCalor(u.calor)}
    </div>
    <div class="uso-bloco">
      <h4>Acessos por dia</h4>
      ${barrasPorDia(u.serie)}
    </div>
    <div class="uso-tabelas">
      ${tabelaUso("Quem acessou com login", ["Pessoa", "Acessos", "Último"],
        u.equipe.map((e) => [`${e.nome}${e.perfil === "usuario" ? " (usuário)" : ""}`, e.n, dataCurta(e.ultimo)]),
        "Ninguém entrou com login neste período.")}
      ${tabelaUso("Seções mais vistas", ["Seção", "Vezes"], u.visoes.map((v) => [NOME_VISAO[v.chave] || v.chave, v.n]),
        "Só o Início foi usado.")}
      ${tabelaUso("Instituições mais abertas", ["Instituição", "Notícias"], u.instituicoes.map((i) => [i.chave, i.n]),
        "Nenhuma notícia aberta.")}
      ${tabelaUso("Notícias mais abertas", ["Notícia", "Vezes"], u.noticias.map((n) => [`${n.instituicao ? `[${n.instituicao}] ` : ""}${n.chave}`, n.n]),
        "Nenhuma notícia aberta.")}
      ${tabelaUso("Buscas mais feitas", ["Termo", "Vezes"], u.buscas.map((b) => [b.chave, b.n]), "Nenhuma busca.")}
    </div>`;
}

function mapaDeCalor(calor) {
  const max = Math.max(1, ...calor.flat());
  const nivel = (n) => (n ? Math.min(5, Math.ceil((n / max) * 5)) : 0);
  const horas = Array.from({ length: 24 }, (_, h) => h);
  const cab = horas.map((h) => `<span class="calor-hora">${h % 3 === 0 ? `${h}h` : ""}</span>`).join("");
  const linhas = DIAS_SEMANA.map(([rot, d]) => `<span class="calor-dia">${rot}</span>` + horas.map((h) => {
    const n = calor[d][h];
    const dica = `${NOME_DIA[d]}, ${h}h–${h + 1}h: ${n} acesso${n === 1 ? "" : "s"}`;
    return `<span class="calor-cel n${nivel(n)}" data-dica="${esc(dica)}" aria-label="${esc(dica)}"></span>`;
  }).join("")).join("");
  const legenda = [0, 1, 2, 3, 4, 5].map((i) => `<span class="calor-cel n${i}"></span>`).join("");
  return `<div class="calor-rolagem"><div class="calor" role="img" aria-label="Mapa de calor de acessos por dia da semana e hora">
      <span></span>${cab}${linhas}</div></div>
    <div class="calor-legenda"><span>menos</span>${legenda}<span>mais (até ${max} acesso${max > 1 ? "s" : ""} na mesma hora)</span></div>`;
}

function barrasPorDia(serie) {
  const max = Math.max(1, ...serie.map((s) => s.equipe + (s.usuarios || 0) + s.publico));
  const marcar = Math.max(1, Math.ceil(serie.length / 10)); // rótulo de data a cada N barras
  const barras = serie.map((s, i) => {
    const [a, m, d] = s.dia.split("-");
    const u = s.usuarios || 0;
    const dica = `${d}/${m}: ${s.equipe + u + s.publico} acesso(s) · equipe ${s.equipe} · usuários ${u} · visitantes ${s.publico}`;
    return `<div class="barra" data-dica="${esc(dica)}" aria-label="${esc(dica)}">
        <div class="barra-pilha">
          ${s.publico ? `<span class="seg seg-publico" style="height:${(s.publico / max) * 100}%"></span>` : ""}
          ${u ? `<span class="seg seg-usuarios" style="height:${(u / max) * 100}%"></span>` : ""}
          ${s.equipe ? `<span class="seg seg-equipe" style="height:${(s.equipe / max) * 100}%"></span>` : ""}
        </div>
        <span class="barra-rot">${i % marcar === 0 || i === serie.length - 1 ? `${d}/${m}` : ""}</span>
      </div>`;
  }).join("");
  return `<div class="barras-legenda"><span><i class="seg-equipe"></i>Equipe CINEA</span><span><i class="seg-usuarios"></i>Usuários (conta própria)</span><span><i class="seg-publico"></i>Visitantes</span>
      <span class="meta">máximo: ${max} por dia</span></div>
    <div class="barras" style="--n:${serie.length}">${barras}</div>`;
}

function tabelaUso(titulo, colunas, linhas, vazio) {
  return `<div class="uso-tabela"><h4>${esc(titulo)}</h4>${linhas.length
    ? `<table class="tabela"><thead><tr>${colunas.map((c, i) => `<th${i ? ' class="num-col"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>
       <tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="num-col"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="carregando">${esc(vazio)}</p>`}</div>`;
}

// Dica flutuante (mapa de calor e barras): aparece ao passar o mouse ou tocar.
function ligarDicas(caixa) {
  let dica = $a("dica-uso");
  if (!dica) {
    dica = document.createElement("div");
    dica.id = "dica-uso"; dica.className = "dica-flutuante"; dica.setAttribute("role", "tooltip");
    document.body.appendChild(dica);
  }
  const mostrar = (e) => {
    const alvo = e.target.closest("[data-dica]");
    if (!alvo || !caixa.contains(alvo)) { dica.classList.remove("visivel"); return; }
    dica.textContent = alvo.dataset.dica;
    const r = alvo.getBoundingClientRect();
    dica.classList.add("visivel");
    dica.style.left = Math.max(8, Math.min(r.left + r.width / 2 - dica.offsetWidth / 2, innerWidth - dica.offsetWidth - 8)) + "px";
    dica.style.top = Math.max(8, r.top - dica.offsetHeight - 8) + "px";
  };
  caixa.addEventListener("mouseover", mostrar);
  caixa.addEventListener("click", mostrar);
  caixa.addEventListener("mouseleave", () => dica.classList.remove("visivel"));
}
