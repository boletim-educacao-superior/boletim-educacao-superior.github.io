// Painel do Radar da Educação Superior.
// Lê dados/itens.json e dados/status.json (gerados pelo coletor) e filtra no navegador.
// Marcações ("sinalizada", "sem relevância" e "lida") são da equipe: ficam no servidor de acesso
// (acesso.js / acesso/Acesso.gs) e aparecem para todos, com quem marcou. A "última visita" fica no localStorage.

const VERSAO_APP = "20261026143616"; // carimbado por ferramentas/versao.py; conferido em acesso.js (conferirVersao)

const CONFIG = {
  // Repositório no GitHub ("usuario/repositorio"). Se vazio, é deduzido do
  // endereço do GitHub Pages (usuario.github.io/repositorio).
  repositorio: "boletim-educacao-superior/boletim-educacao-superior.github.io",
  arquivoWorkflow: "coleta.yml",
};

const PRIORIDADES = { urgente: 0, alta: 1, media: 2, baixa: 3 };
const PRIORIDADE_MINIMA = "alta"; // o que for abaixo disso (média, baixa) não aparece no painel
const ROTULO_PRIORIDADE = { urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };
// Nomes completos dos setores do CINEA (os itens trazem a forma curta, de config/regras.toml).
const NOME_SETOR = {
  Hub: "Hub de Integração e Relacionamento",
  "Inovação": "Inovação Pedagógica e Formação Continuada",
  Tecnologias: "Tecnologias e Experiências de Aprendizagem",
};

const estado = {
  itens: [],
  instituicoes: new Set(),
  lidos: new Map(),       // id da notícia → { por, nome, em } (quem da equipe leu primeiro)
  marcas: new Map(),      // id da notícia → { tipo, por, nome, em, motivo }
  ultimaVisita: null,
  somenteNovos: false,
  visao: "inicio",
  pagina: 1,
};
const POR_PAGINA = 20;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ visões --
// Cada item do menu é um recorte. "Sinalizadas" e "Sem relevância" mostram tudo o que foi marcado,
// sem o filtro de período, para nada marcado ficar escondido.
const marca = (it) => estado.marcas.get(it.id)?.tipo;
const VISOES = {
  "inicio": {
    titulo: "Início",
    explica: "As notícias mais importantes para a educação superior, coletadas todos os dias de MEC, INEP, CNE, CAPES, " +
      "SEMESP, ABMES, ABED, FAPEMIG, CEE-MG e Diário Oficial da União.",
    filtro: (it) => marca(it) !== "irrelevante",
  },
  "sinalizadas": {
    titulo: "Sinalizadas", explica: "Notícias que alguém da equipe marcou para acompanhar. Todos veem as mesmas.",
    filtro: (it) => marca(it) === "sinalizada", semPeriodo: true, semPrioridade: true,
  },
  "nao-lidas": {
    titulo: "Não lidas", explica: "O que ninguém da equipe abriu nem marcou como lido ainda.",
    filtro: (it) => !estado.lidos.has(it.id) && marca(it) !== "irrelevante",
  },
  "lidas": {
    titulo: "Lidas", explica: "O que alguém da equipe já abriu ou marcou como lido, com o nome de quem leu.",
    filtro: (it) => estado.lidos.has(it.id),
  },
  "sem-relevancia": {
    titulo: "Sem relevância", explica: "Notícias que a equipe marcou como fora do nosso interesse. Os motivos ajudam a ajustar as regras de triagem.",
    filtro: (it) => marca(it) === "irrelevante", semPeriodo: true, semPrioridade: true, comRotina: true,
  },
};

// Para quem criou a própria conta (perfil Usuário), sinalizadas e lidas são pessoais.
const EXPLICA_USUARIO = {
  "sinalizadas": "As notícias que você sinalizou para acompanhar (só você vê).",
  "nao-lidas": "O que você ainda não abriu nem marcou como lido.",
  "lidas": "O que você já abriu ou marcou como lido (só você vê).",
  "sem-relevancia": "Notícias que a equipe do CINEA marcou como fora do escopo do Boletim.",
};

// ------------------------------------------------------------ armazenamento --
function lerLocal(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : JSON.parse(v);
  } catch { return padrao; }
}
function gravarLocal(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* modo privado */ }
}

// ------------------------------------------------------------------- dados --
async function carregar() {
  const [itens, status, marcacoes] = await Promise.all([
    fetch("dados/itens.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    fetch("dados/status.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    lerMarcacoes().catch(() => ({ marcas: [], lidos: [] })),
  ]);
  // Só urgentes e alta prioridade aparecem (pedido do Diego, 23/10/2026). Baixa e média continuam nos dados:
  // se as regras de triagem mudarem e um item subir de prioridade, ele passa a aparecer sozinho.
  estado.itens = itens.filter((it) => PRIORIDADES[it.prioridade] <= PRIORIDADES[PRIORIDADE_MINIMA]);
  aplicarMarcacoes(marcacoes.marcas);
  aplicarLidos(marcacoes.lidos);
  if (logado()) migrarLidosDoNavegador();
  // "Novos desde a sua última visita" vem do registro de acesso de quem entrou (servidor), não do navegador.
  // Visitante sem login não tem esse registro: o cartão pede para entrar.
  estado.ultimaVisita = logado() && Acesso.perfil.visita_anterior ? brasiliaParaData(Acesso.perfil.visita_anterior) : null;

  montarFiltros();
  restaurarFiltros();
  mostrarStatus(status);
  configurarBotaoColeta();
  irPara(location.hash);
  registrarEvento("abertura", estado.visao);
}

const logado = () => !!Acesso.perfil;
/** "2026-10-23 14:05:00" (horário de Brasília, como o servidor grava) → Date. */
function brasiliaParaData(t) {
  const d = new Date(String(t).replace(" ", "T") + "-03:00");
  return isNaN(d) ? null : d;
}

/** Marcações: a equipe vê tudo (com nomes); o visitante só o que está "sem relevância", para o Início esconder igual. */
async function lerMarcacoes() {
  if (logado()) return api("marcacoes");
  const r = await servidor("publico");
  return { marcas: r.irrelevantes.map((id) => ({ id, tipo: "irrelevante" })), lidos: [] };
}

function aplicarMarcacoes(lista) {
  estado.marcas = new Map(lista.map((m) => [m.id, m]));
}
function aplicarLidos(lista) {
  estado.lidos = new Map(lista.map((l) => [l.id, l]));
}
const eu = () => ({ por: Acesso.perfil.email, nome: Acesso.perfil.nome, em: new Date().toLocaleDateString("sv-SE") });

// Base compartilhada: busca de novo o que a equipe marcou a cada 90 s e quando a aba volta a ficar visível,
// para o que um colega marca aparecer sem recarregar a página.
const ATUALIZAR_MARCACOES_S = 90;
let ultimaFoto = "";
async function atualizarMarcacoes() {
  if (!painelIniciado || document.hidden || fila.lidas.size || fila.naoLidas.size || [...estado.marcas.values()].some((m) => m.pendente)) return;
  try {
    const r = await lerMarcacoes();
    const foto = JSON.stringify(r);
    if (foto === ultimaFoto) return;
    ultimaFoto = foto;
    aplicarMarcacoes(r.marcas);
    aplicarLidos(r.lidos);
    render();
  } catch { /* tenta na próxima */ }
}
setInterval(atualizarMarcacoes, ATUALIZAR_MARCACOES_S * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizarMarcacoes(); });

// Antes do login, "lido" ficava só no navegador. Na primeira entrada, leva esses lidos para o servidor.
function migrarLidosDoNavegador() {
  const antigos = lerLocal("radar.lidos", null);
  if (!Array.isArray(antigos)) return;
  const novos = antigos.filter((id) => !estado.lidos.has(id));
  novos.forEach((id) => estado.lidos.set(id, eu()));
  try { localStorage.removeItem("radar.lidos"); } catch { /* modo privado */ }
  if (novos.length) api("marcarLidos", novos, true).catch(() => {});
}

function ehNovo(it) {
  return estado.ultimaVisita ? new Date(it.visto_em) > estado.ultimaVisita : false;
}

// ---------------------------------------------------------------- uso do painel --
// Cada navegador ganha um número aleatório (sem nenhum dado pessoal); quem entrou é identificado pela sessão.
// O servidor junta tudo no relatório "Uso da plataforma" dos administradores.
function idVisitante() {
  let v = lerLocal("radar.visitante", null);
  if (!/^[a-z0-9]{10,40}$/.test(v || "")) {
    v = (crypto.randomUUID ? crypto.randomUUID() : `${Math.random()}${Date.now()}`).replace(/[^a-z0-9]/g, "").slice(0, 32);
    gravarLocal("radar.visitante", v);
  }
  return v;
}
function registrarEvento(tipo, detalhe = "") {
  const url = urlServidor();
  if (!url) return;
  const corpo = { acao: "evento", visitante: idVisitante(), tipo, detalhe: String(detalhe).slice(0, 140),
                  dispositivo: innerWidth < 720 ? "celular" : "computador", sessao: Acesso.sessao || "" };
  if (url === "simulado") { window.SimuladorAcesso?.chamar(corpo); return; }
  // keepalive: o registro sai mesmo se a pessoa abrir a notícia e fechar a aba em seguida.
  fetch(url, { method: "POST", body: JSON.stringify(corpo), keepalive: true }).catch(() => {});
}

// ------------------------------------------------------------------ páginas --
// O endereço manda: #inicio, #sinalizadas, #nao-lidas, #lidas, #sem-relevancia ou #admin.
function irPara(hash) {
  const nome = String(hash || "").replace(/^#/, "") || "inicio";
  const admin = nome === "admin" && Acesso.perfil?.admin;
  $("pagina-radar").hidden = admin;
  $("pagina-admin").hidden = !admin;
  if (admin) {
    marcarMenu(null);
    abrirPaginaAdmin();
    return;
  }
  let visao = VISOES[nome] ? nome : "inicio";
  if (visao !== "inicio" && !logado()) {  // Sinalizadas, Lidas etc. são da equipe
    pedirLogin(`"${VISOES[visao].titulo}" é uma área para quem tem conta. Entre para acompanhar as notícias sinalizadas, lidas e sem relevância.`);
    visao = "inicio";
  }
  if (nome === "admin" && !admin) visao = "inicio";
  if (visao !== estado.visao) estado.pagina = 1;
  estado.visao = visao;
  marcarMenu(estado.visao);
  $("visao-titulo").textContent = VISOES[estado.visao].titulo;
  $("visao-explica").textContent = ehUsuario() && EXPLICA_USUARIO[estado.visao] || VISOES[estado.visao].explica;
  // Atalhos de prioridade e "novos" só fazem sentido no Início.
  $("pagina-radar").classList.toggle("visao-inicio", estado.visao === "inicio");
  render();
}
window.addEventListener("hashchange", () => {
  if (!painelIniciado) return;
  irPara(location.hash);
  window.scrollTo(0, 0);
  registrarEvento("visao", String(location.hash || "#inicio").slice(1));
});

function marcarMenu(visao) {
  document.querySelectorAll(".menu-principal [data-visao]").forEach((a) => {
    const atual = a.dataset.visao === visao;
    a.classList.toggle("ativo", atual);
    atual ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
}

function atualizarContadores() {
  const conta = (v) => estado.itens.filter(VISOES[v].filtro).length;
  for (const v of ["sinalizadas", "nao-lidas", "lidas", "sem-relevancia"]) {
    const n = conta(v);
    $(`c-${v}`).textContent = n ? n : "";
  }
}

// ----------------------------------------------------------------- filtros --
function contar(chave) {
  const c = new Map();
  for (const it of estado.itens) {
    for (const v of [].concat(it[chave] || [])) c.set(v, (c.get(v) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}

function montarFiltros() {
  for (const [sel, chave] of [["f-setor", "setores"], ["f-tema", "temas"], ["f-tipo", "tipo"]]) {
    for (const [v, n] of contar(chave)) {
      const o = document.createElement("option");
      o.value = v; o.textContent = `${NOME_SETOR[v] && chave === "setores" ? NOME_SETOR[v] : v} (${n})`;
      $(sel).appendChild(o);
    }
  }
  const caixa = $("f-instituicoes");
  for (const [v, n] of contar("instituicao")) {
    const b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.dataset.valor = v;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `${v}<span class="qtd">${n}</span>`;
    b.addEventListener("click", () => {
      estado.instituicoes.has(v) ? estado.instituicoes.delete(v) : estado.instituicoes.add(v);
      b.setAttribute("aria-pressed", String(estado.instituicoes.has(v)));
      estado.pagina = 1;
      render();
    });
    caixa.appendChild(b);
  }
  for (const id of ["f-busca", "f-prioridade", "f-setor", "f-tema", "f-tipo", "f-periodo", "f-rotina"]) {
    $(id).addEventListener(id === "f-busca" ? "input" : "change", () => { estado.somenteNovos = false; estado.pagina = 1; render(); });
  }
  document.querySelectorAll("[data-atalho]").forEach((b) =>
    b.addEventListener("click", () => aplicarAtalho(b.dataset.atalho)));
  $("btn-limpar").addEventListener("click", () => aplicarAtalho("limpar"));
  ligarInfoPrioridade();
  $("btn-csv").addEventListener("click", exportarCSV);
  $("btn-lertodos").addEventListener("click", () => marcarLidos(paginaAtual(filtrar()).map((it) => it.id), true));
  // Visitante: o cartão de novidades leva à entrada (não há registro de visita sem login).
  if (!logado()) {
    $("n-novos-rot").textContent = "Entre para ver o que é novo desde a sua última visita";
    $("n-novos").textContent = "🔒";
  }
  // Botão "Buscar" (e Enter): a busca já filtra enquanto se digita; o botão confirma e leva ao resultado.
  $("form-busca").addEventListener("submit", () => {
    if ($("f-busca").value.trim()) registrarEvento("busca", $("f-busca").value.trim().slice(0, 80));
    estado.somenteNovos = false; estado.pagina = 1; render();
    $("contagem").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Balão "O que significa Urgente e Alta": abre e fecha no (i); fecha ao clicar fora ou com Esc.
function ligarInfoPrioridade() {
  const b = $("btn-info-prioridade"), pop = $("info-prioridade");
  const abrir = (sim) => { pop.hidden = !sim; b.setAttribute("aria-expanded", String(sim)); };
  b.addEventListener("click", (e) => { e.stopPropagation(); abrir(pop.hidden); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) abrir(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { abrir(false); b.focus(); } });
}

function aplicarAtalho(nome) {
  $("f-busca").value = ""; $("f-tema").value = ""; $("f-setor").value = ""; $("f-tipo").value = "";
  $("f-rotina").checked = true;
  estado.instituicoes.clear();
  document.querySelectorAll(".chip[data-valor]").forEach((c) => c.setAttribute("aria-pressed", "false"));
  if (nome === "novos" && !logado()) {
    pedirLogin("Para ver o que é novo desde a sua última visita, entre com seu usuário: a última visita é registrada no login.");
    return;
  }
  estado.somenteNovos = nome === "novos";
  $("f-prioridade").value = nome === "urgente" ? "urgente" : "alta+";
  if (nome === "limpar") $("f-periodo").value = PERIODO_INICIAL;
  estado.pagina = 1;
  render();
}

// Todo mundo (com ou sem login) abre igual: urgente e alta dos últimos 30 dias, urgentes primeiro
// (pedido do Diego, 26/10/2026). Os filtros não são guardados entre uma visita e outra.
const PRIORIDADE_INICIAL = "alta+";
const PERIODO_INICIAL = "30";
function restaurarFiltros() {
  $("f-prioridade").value = PRIORIDADE_INICIAL;
  $("f-periodo").value = PERIODO_INICIAL;
}

function semAcento(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function filtrar() {
  const visao = VISOES[estado.visao];
  const busca = semAcento($("f-busca").value.trim());
  const prio = visao.semPrioridade ? "" : $("f-prioridade").value;
  const tema = $("f-tema").value;
  const setor = $("f-setor").value;
  const tipo = $("f-tipo").value;
  const dias = visao.semPeriodo ? "" : $("f-periodo").value;
  const ocultarRotina = $("f-rotina").checked && !visao.comRotina;
  const limite = limitePeriodo(dias);
  const maxPrio = { urgente: 0, "alta+": 1, "media+": 2 }[prio] ?? 3;

  const lista = estado.itens.filter((it) => {
    if (!visao.filtro(it)) return false;
    if (estado.somenteNovos && !ehNovo(it)) return false;
    if (PRIORIDADES[it.prioridade] > maxPrio) return false;
    if (estado.instituicoes.size && !estado.instituicoes.has(it.instituicao)) return false;
    if (tema && !(it.temas || []).includes(tema)) return false;
    if (setor && !(it.setores || []).includes(setor)) return false;
    if (tipo && it.tipo !== tipo) return false;
    if (limite && (it.data || "") < limite) return false;
    if (ocultarRotina && it.rotina && it.prioridade !== "urgente" && !marca(it)) return false;
    if (busca && !semAcento(`${it.titulo} ${it.resumo} ${it.orgao} ${it.fonte}`).includes(busca)) return false;
    return true;
  });
  // Urgentes primeiro, depois alta; dentro de cada uma, da mais recente para a mais antiga (os itens já vêm por data).
  return visao.semPrioridade ? lista : lista.sort((a, b) => PRIORIDADES[a.prioridade] - PRIORIDADES[b.prioridade]);
}

// -------------------------------------------------------------- renderização --
function formatarData(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function render() {
  atualizarContadores();
  const visiveis = filtrar();
  preencherCartoes();
  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA));
  estado.pagina = Math.min(Math.max(1, estado.pagina), paginas);
  const ini = (estado.pagina - 1) * POR_PAGINA;
  const total = estado.somenteNovos ? `${visiveis.length} item(ns) novo(s) desde sua última visita`
    : `${visiveis.length} item(ns) com os filtros atuais`;
  $("contagem").textContent = visiveis.length > POR_PAGINA
    ? `${total} · mostrando ${ini + 1}–${Math.min(ini + POR_PAGINA, visiveis.length)}` : total;
  montarPaginacao(paginas);

  const lista = $("lista");
  lista.replaceChildren();
  if (!visiveis.length) {
    const li = document.createElement("li");
    li.className = "vazio";
    const vazio = {
      "sinalizadas": 'Nenhuma notícia sinalizada. Use "☆ Sinalizar" numa notícia para a equipe acompanhar.',
      "sem-relevancia": "Nada foi marcado como sem relevância.",
      "lidas": "Você ainda não leu nenhuma notícia com esses filtros.",
      "nao-lidas": "Você já leu tudo o que aparece com esses filtros.",
    }[estado.visao];
    li.textContent = !estado.itens.length ? "Ainda não há dados. Rode a primeira coleta."
      : vazio || "Nenhum item com esses filtros. Experimente ampliar o período ou limpar os filtros.";
    lista.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of paginaAtual(visiveis)) frag.appendChild(montarItem(it));
  lista.appendChild(frag);
}

/**
 * Cartões do Início: o número segue o período do filtro ("nos últimos 30 dias"); a linha de baixo
 * dá a referência do ano ("72 desde janeiro"), para ter noção de escala. Sem relevância não conta.
 */
function preencherCartoes() {
  const periodo = $("f-periodo").value, limite = limitePeriodo(periodo);
  const validos = estado.itens.filter((it) => marca(it) !== "irrelevante");
  const conta = (lista) => lista.filter((it) => !limite || (it.data || "") >= limite).length;
  $("n-urgente").textContent = conta(validos.filter((it) => it.prioridade === "urgente"));
  $("n-alta").textContent = conta(validos.filter((it) => it.prioridade === "alta"));
  $("n-total").textContent = conta(validos);
  // Legenda simples (pedido do Diego, 26/10/2026): "Indicadores dos últimos 30 dias. Para mudar, use o filtro "Período"."
  const maisAntigo = validos.reduce((m, it) => (it.data && it.data < m ? it.data : m), "9999-12-31");
  const NOME_PERIODO = { "7": "dos últimos 7 dias", "30": "dos últimos 30 dias", "90": "dos últimos 90 dias",
                         "180": "dos últimos 6 meses", "365": "dos últimos 12 meses",
                         "ano": `de ${new Date().getFullYear()} (desde janeiro)` };
  $("resumo-periodo").innerHTML = `Indicadores <b>${NOME_PERIODO[periodo] || `de todo o histórico (desde ${formatarData(maisAntigo)})`}</b>. ` +
    'Para mudar, use o filtro "Período".';
  if (logado()) {
    $("n-novos").textContent = estado.itens.filter(ehNovo).length;
    $("n-novos-det").textContent = estado.ultimaVisita
      ? `desde ${estado.ultimaVisita.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
      : "esta é a sua primeira visita";
  }
}

/** Data mais antiga do período escolhido ("" = sem limite). */
function limitePeriodo(dias) {
  return !dias ? "" : dias === "ano" ? `${new Date().getFullYear()}-01-01`
    : new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
}

function paginaAtual(lista) {
  return lista.slice((estado.pagina - 1) * POR_PAGINA, estado.pagina * POR_PAGINA);
}

/** « Anterior · 1 … 4 5 6 … 204 · Próxima » — 20 notícias por página. */
function montarPaginacao(paginas) {
  const nav = $("paginacao");
  nav.hidden = paginas <= 1;
  if (paginas <= 1) { nav.replaceChildren(); return; }
  const p = estado.pagina;
  const numeros = [...new Set([1, p - 2, p - 1, p, p + 1, p + 2, paginas])].filter((n) => n >= 1 && n <= paginas).sort((a, b) => a - b);
  const botao = (rotulo, destino, extra = "") =>
    `<button type="button" class="pag${extra}" data-pagina="${destino}"${destino === p && !extra ? ' aria-current="page"' : ""}` +
    `${destino < 1 || destino > paginas ? " disabled" : ""}>${rotulo}</button>`;
  let html = botao("‹ Anterior", p - 1, " pag-seta");
  numeros.forEach((n, i) => {
    if (i && n - numeros[i - 1] > 1) html += '<span class="pag-reticencias">…</span>';
    html += botao(String(n), n);
  });
  html += botao("Próxima ›", p + 1, " pag-seta");
  nav.innerHTML = html;
  nav.querySelectorAll("[data-pagina]").forEach((b) => b.addEventListener("click", () => {
    estado.pagina = Number(b.dataset.pagina);
    render();
    $("contagem").scrollIntoView({ block: "start" });
  }));
}

function montarItem(it) {
  const el = $("tpl-item").content.firstElementChild.cloneNode(true);
  el.dataset.id = it.id;
  el.classList.add(`p-${it.prioridade}`);
  if (ehNovo(it)) el.classList.add("e-novo");
  el.querySelector(".badge-prio").textContent = ROTULO_PRIORIDADE[it.prioridade];
  el.querySelector(".badge-inst").textContent = it.instituicao;
  el.querySelector(".item-tipo").textContent = it.tipo;
  const t = el.querySelector(".item-data");
  t.textContent = formatarData(it.data); t.dateTime = it.data;
  const a = el.querySelector(".item-titulo a");
  a.href = it.link; a.textContent = it.titulo;
  a.addEventListener("click", () => {
    registrarEvento("noticia", `${it.instituicao}|${it.prioridade}|${it.titulo.slice(0, 100)}`);
    if (logado() && !estado.lidos.has(it.id)) marcarLidos([it.id], true);
  });
  el.querySelector(".motivo").textContent = it.motivo_urgencia ? `⚑ ${it.motivo_urgencia}` : "";
  el.querySelector(".item-resumo").textContent = it.resumo ? it.resumo.slice(0, 320) + (it.resumo.length > 320 ? "…" : "") : "";
  const setores = el.querySelector(".setores");
  for (const s of it.setores || []) {
    const span = document.createElement("span");
    span.className = "tag-setor"; span.textContent = s; span.title = `Setor indicado: ${NOME_SETOR[s] || s}`;
    setores.appendChild(span);
  }
  const temas = el.querySelector(".temas");
  for (const tm of it.temas || []) {
    const s = document.createElement("span"); s.className = "tag"; s.textContent = tm; temas.appendChild(s);
  }
  const org = el.querySelector(".orgao");
  org.textContent = [it.fonte, it.orgao].filter(Boolean).join(" · ");
  org.title = org.textContent;
  if (!logado()) {
    // Visitante: os botões aparecem com cadeado e explicam que é preciso entrar.
    const precisa = { "btn-sinalizar": "Para sinalizar, você precisa estar logado. Não tem conta? Crie a sua, é grátis.",
                      "btn-irrelevante": "Para marcar como sem relevância, você precisa estar logado.",
                      "btn-lido": "Para marcar como lida, você precisa estar logado. Não tem conta? Crie a sua, é grátis." };
    for (const [classe, texto] of Object.entries(precisa)) {
      const b = el.querySelector(`.${classe}`);
      b.classList.add("bloqueada");
      b.title = texto;
      b.addEventListener("click", () => pedirLogin(texto));
    }
    pintarItem(el, it);
    return el;
  }
  el.querySelector(".btn-sinalizar").addEventListener("click", () => alternarMarca(it, "sinalizada"));
  if (ehUsuario()) {
    const b = el.querySelector(".btn-irrelevante");
    b.classList.add("bloqueada");
    b.title = "Só a equipe do CINEA marca notícias como sem relevância (vale para todos).";
    b.addEventListener("click", () => aviso(b.title));
    el.querySelector(".btn-lido").addEventListener("click", () => marcarLidos([it.id], !estado.lidos.has(it.id)));
    pintarItem(el, it);
    return el;
  }
  el.querySelector(".btn-irrelevante").addEventListener("click", () =>
    marca(it) === "irrelevante" ? alternarMarca(it, "irrelevante") : pedirMotivo(it));
  el.querySelector(".btn-lido").addEventListener("click", () => marcarLidos([it.id], !estado.lidos.has(it.id)));
  pintarItem(el, it);
  return el;
}

/** Atualiza só a aparência de um item (marcas e lido), sem refazer a lista. */
function pintarItem(el, it) {
  const m = estado.marcas.get(it.id), lido = estado.lidos.has(it.id);
  el.classList.toggle("lido", lido);
  el.classList.toggle("sinalizada", m?.tipo === "sinalizada");
  el.classList.toggle("irrelevante", m?.tipo === "irrelevante");
  const s = el.querySelector(".btn-sinalizar");
  if (!logado()) {  // visitante: rótulos fixos com cadeado; nada de nomes da equipe
    s.textContent = "🔒 Sinalizar";
    el.querySelector(".btn-irrelevante").textContent = "🔒 Sem relevância";
    el.querySelector(".btn-lido").textContent = "🔒 Marcar como lida";
    el.querySelector(".marca-info").textContent = "";
    return;
  }
  s.textContent = m?.tipo === "sinalizada" ? "★ Sinalizada" : "☆ Sinalizar";
  s.setAttribute("aria-pressed", String(m?.tipo === "sinalizada"));
  s.title = m?.tipo === "sinalizada" ? "Tirar a sinalização (para toda a equipe)" : "Sinalizar para a equipe acompanhar";
  el.querySelector(".btn-irrelevante").textContent = ehUsuario() ? "🔒 Sem relevância"
    : m?.tipo === "irrelevante" ? "↺ Desfazer “sem relevância”" : "Sem relevância";
  el.querySelector(".btn-lido").textContent = lido ? "Marcar como não lida" : "Marcar como lida";
  const info = el.querySelector(".marca-info");
  info.className = "marca-info" + (m ? ` marca-${m.tipo}` : "");
  const quando = (x) => (x.em ? ` em ${formatarData(String(x.em).slice(0, 10))}` : "");
  const quem = (x) => (x.por && x.por === Acesso.perfil?.email ? "você" : x.nome || x.por);
  const partes = [];
  if (m) partes.push(m.pendente ? "Salvando…"
    : m.tipo === "irrelevante" && !m.por ? "Marcada pela equipe como sem relevância"
    : `${m.tipo === "sinalizada" ? "Sinalizada" : "Sem relevância"} por ${quem(m)}${quando(m)}${m.motivo ? ` · “${m.motivo}”` : ""}`);
  if (lido) { const l = estado.lidos.get(it.id); partes.push(`Lida por ${quem(l)}${quando(l)}`); }
  info.textContent = partes.join(" · ");
}

function repintar(id) {
  const it = estado.itens.find((x) => x.id === id);
  const el = document.querySelector(`#lista [data-id="${CSS.escape(id)}"]`);
  if (it && el) pintarItem(el, it);
}

// ---------------------------------------------------------------- marcações --
// A tela muda na hora; o servidor (que leva alguns segundos) confirma depois. Se der erro, desfaz e avisa.
async function alternarMarca(it, tipo, motivo = "") {
  const antes = estado.marcas.get(it.id);
  const ativo = antes?.tipo !== tipo;
  if (ativo) estado.marcas.set(it.id, { id: it.id, tipo, por: Acesso.perfil.email, nome: Acesso.perfil.nome, motivo, pendente: true });
  else estado.marcas.delete(it.id);
  repintar(it.id); atualizarContadores();
  try {
    aplicarMarcacoes(await api("marcar", it.id, tipo, ativo, motivo, it.titulo, it.link));
    aviso(ativo ? (tipo === "sinalizada" ? (ehUsuario() ? "Sinalizada para você acompanhar." : "Sinalizada para a equipe.")
      : "Marcada como sem relevância.") : "Marcação desfeita.");
  } catch (e) {
    antes ? estado.marcas.set(it.id, antes) : estado.marcas.delete(it.id);
    aviso(`Não foi possível salvar: ${e.message}`, true);
  }
  // Sair ou entrar no recorte atual (ex.: tirar a sinalização dentro de "Sinalizadas") refaz a lista.
  render();
}

const SUGESTOES_MOTIVO = ["Ato de outra instituição", "Educação básica", "Fora do nosso escopo", "Notícia repetida", "Evento sem relação"];
let itemMotivo = null;
function pedirMotivo(it) {
  itemMotivo = it;
  $("irr-noticia").textContent = it.titulo;
  $("irr-motivo").value = "";
  $("irr-sugestoes").innerHTML = SUGESTOES_MOTIVO.map((s) => `<button type="button" class="chip">${escapar(s)}</button>`).join("");
  $("irr-sugestoes").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { $("irr-motivo").value = b.textContent; }));
  $("dlg-irrelevante").showModal();
  $("irr-motivo").focus();
}
$("form-irrelevante").addEventListener("submit", (ev) => {
  ev.preventDefault();
  $("dlg-irrelevante").close();
  if (itemMotivo) alternarMarca(itemMotivo, "irrelevante", $("irr-motivo").value.trim());
});

// Lidas: a tela muda na hora e os pedidos ao servidor são juntados (um clique atrás do outro vira um pedido só).
const fila = { lidas: new Set(), naoLidas: new Set(), timer: null };
function marcarLidos(ids, lido) {
  for (const id of ids) {
    if (lido) { if (!estado.lidos.has(id)) estado.lidos.set(id, eu()); } else estado.lidos.delete(id);
    (lido ? fila.lidas : fila.naoLidas).add(id);
    (lido ? fila.naoLidas : fila.lidas).delete(id);
  }
  clearTimeout(fila.timer);
  fila.timer = setTimeout(enviarLidos, 1200);
  if (ids.length === 1 && estado.visao !== "lidas" && estado.visao !== "nao-lidas") { repintar(ids[0]); atualizarContadores(); }
  else render();
}
async function enviarLidos() {
  const lidas = [...fila.lidas], naoLidas = [...fila.naoLidas];
  fila.lidas.clear(); fila.naoLidas.clear();
  try {
    if (lidas.length) await api("marcarLidos", lidas, true);
    if (naoLidas.length) await api("marcarLidos", naoLidas, false);
  } catch (e) {
    aviso(`Não foi possível salvar as notícias lidas: ${e.message}`, true);
  }
}
// Se a pessoa fechar a aba logo depois de marcar, ainda tenta mandar.
window.addEventListener("pagehide", () => { if (fila.lidas.size || fila.naoLidas.size) enviarLidos(); });

function aviso(texto, erro = false) {
  let a = $("aviso");
  if (!a) {
    a = document.createElement("div");
    a.id = "aviso"; a.className = "aviso"; a.setAttribute("role", "status");
    document.body.appendChild(a);
  }
  a.textContent = texto;
  a.classList.toggle("aviso-erro", erro);
  a.classList.add("visivel");
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.remove("visivel"), erro ? 6000 : 2500);
}

// --------------------------------------------------------------- utilidades --
function mostrarStatus(status) {
  if (!status) { $("atualizado").textContent = "Sem informação de coleta"; return; }
  const quando = new Date(status.ultima_execucao);
  $("atualizado").textContent = "Última coleta: " + quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  mostrarAgenda(status.agenda);
  const falhas = status.fontes.filter((f) => !f.ok);
  $("status-resumo").textContent = falhas.length
    ? `· ${falhas.length} fonte(s) com erro`
    : `· todas as ${status.fontes.length} fontes ok`;
  const corpo = $("status-tabela");
  for (const f of status.fontes) {
    const tr = document.createElement("tr");
    const situacao = f.ok ? '<span class="ok">ok</span>' : `<span class="erro">erro: ${escapar(f.erro)}</span>`;
    tr.innerHTML = `<td>${escapar(f.fonte)}</td><td>${situacao}</td><td>${f.ok ? f.itens : "–"}</td>`;
    corpo.appendChild(tr);
  }
}

/**
 * "Coleta automática: dias úteis, às 8h, 12h e 17h · próxima: hoje às 17h".
 * O horário vem do agendamento do GitHub (o coletor lê o coleta.yml), em horário de Brasília.
 */
function mostrarAgenda(ag) {
  if (!ag || !ag.horas?.length) return;
  const el = $("agenda");
  const proxima = proximaColeta(ag);
  el.textContent = `Coleta automática: ${ag.descricao.charAt(0).toLowerCase()}${ag.descricao.slice(1)}`;
  el.title = "Horário de Brasília. O GitHub pode atrasar alguns minutos nos horários de pico.";
  el.hidden = false;
  if (proxima) {
    $("proxima").textContent = `Próxima atualização: ${proxima}`;
    $("proxima").title = el.title;
    $("proxima").hidden = false;
  }
}

function proximaColeta(ag) {
  // "Agora" em Brasília (UTC-3, sem horário de verão).
  const agora = new Date(Date.now() - 3 * 3600e3);
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  for (let d = 0; d < 8; d++) {
    const dia = new Date(agora.getTime() + d * 864e5);
    if (!ag.dias.includes(dia.getUTCDay())) continue;
    for (const h of ag.horas) {
      const minutos = h * 60 + (ag.minuto || 0);
      if (d === 0 && minutos <= agora.getUTCHours() * 60 + agora.getUTCMinutes()) continue;
      const hora = `${h}h${ag.minuto ? String(ag.minuto).padStart(2, "0") : ""}`;
      return d === 0 ? `hoje às ${hora}` : d === 1 ? `amanhã às ${hora}` : `${DIAS[dia.getUTCDay()]} às ${hora}`;
    }
  }
  return "";
}

function configurarBotaoColeta() {
  let repo = CONFIG.repositorio;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!repo && m) repo = `${m[1]}/${location.pathname.split("/").filter(Boolean)[0] || `${m[1]}.github.io`}`;
  const btn = $("btn-coletar");
  if (repo && !repo.endsWith("/")) btn.href = `https://github.com/${repo}/actions/workflows/${CONFIG.arquivoWorkflow}`;
  else btn.hidden = true;
}

function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exportarCSV() {
  registrarEvento("csv", estado.visao);
  const cols = ["data", "prioridade", "instituicao", "tipo", "titulo", "setores", "temas", "motivo_urgencia", "marcacao", "orgao", "link"];
  const linhas = [cols.join(";")];
  for (const it of filtrar()) {
    const m = estado.marcas.get(it.id);
    const linha = { ...it, marcacao: m ? `${m.tipo === "sinalizada" ? "Sinalizada" : "Sem relevância"} (${m.nome || m.por})` : "" };
    linhas.push(cols.map((c) => {
      const v = Array.isArray(linha[c]) ? linha[c].join(", ") : linha[c] ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(";"));
  }
  // BOM para o Excel abrir com acentos corretos.
  const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `radar-${estado.visao}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Chamado por acesso.js depois que a pessoa entra (uma vez por página).
let painelIniciado = false;
function iniciarPainel() {
  if (painelIniciado) return;
  painelIniciado = true;
  carregar().catch((e) => {
    $("lista").innerHTML = `<li class="vazio">Não foi possível carregar os dados (${escapar(e.message)}).</li>`;
  });
}
