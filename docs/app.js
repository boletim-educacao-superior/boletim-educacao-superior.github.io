// Painel do Radar da Educação Superior.
// Lê dados/itens.json e dados/status.json (gerados pelo coletor) e filtra no navegador.
// "Lido" e "última visita" ficam no localStorage de cada pessoa.

const CONFIG = {
  // Repositório no GitHub ("usuario/repositorio"). Se vazio, é deduzido do
  // endereço do GitHub Pages (usuario.github.io/repositorio).
  repositorio: "",
  arquivoWorkflow: "coleta.yml",
};

const PRIORIDADES = { urgente: 0, alta: 1, media: 2, baixa: 3 };
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
  lidos: new Set(),
  ultimaVisita: null,
  somenteNovos: false,
};

const $ = (id) => document.getElementById(id);

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
  const [itens, status] = await Promise.all([
    fetch("dados/itens.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    fetch("dados/status.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  estado.itens = itens;
  estado.lidos = new Set(lerLocal("radar.lidos", []));
  estado.ultimaVisita = lerLocal("radar.ultimaVisita", null);
  // A "última visita" só avança na próxima abertura, para os novos continuarem destacados agora.
  gravarLocal("radar.ultimaVisita", new Date().toISOString());

  montarFiltros();
  restaurarFiltros();
  mostrarStatus(status);
  configurarBotaoColeta();
  render();
}

function ehNovo(it) {
  return estado.ultimaVisita ? it.visto_em > estado.ultimaVisita : false;
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
      render();
    });
    caixa.appendChild(b);
  }
  for (const id of ["f-busca", "f-prioridade", "f-setor", "f-tema", "f-tipo", "f-periodo", "f-rotina", "f-naolidos"]) {
    $(id).addEventListener(id === "f-busca" ? "input" : "change", () => { estado.somenteNovos = false; render(); });
  }
  document.querySelectorAll("[data-atalho]").forEach((b) =>
    b.addEventListener("click", () => aplicarAtalho(b.dataset.atalho)));
  $("btn-limpar").addEventListener("click", () => aplicarAtalho("limpar"));
  $("btn-csv").addEventListener("click", exportarCSV);
  $("btn-lertodos").addEventListener("click", () => {
    filtrar().forEach((it) => estado.lidos.add(it.id));
    gravarLocal("radar.lidos", [...estado.lidos]);
    render();
  });
}

function aplicarAtalho(nome) {
  $("f-busca").value = ""; $("f-tema").value = ""; $("f-setor").value = ""; $("f-tipo").value = "";
  $("f-naolidos").checked = false; $("f-rotina").checked = true;
  estado.instituicoes.clear();
  document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  estado.somenteNovos = nome === "novos";
  $("f-prioridade").value = nome === "urgente" ? "urgente" : nome === "alta" ? "alta+" : "";
  $("f-periodo").value = nome === "limpar" ? "30" : "";
  render();
}

function salvarFiltros() {
  gravarLocal("radar.filtros", {
    prioridade: $("f-prioridade").value, periodo: $("f-periodo").value, setor: $("f-setor").value,
    rotina: $("f-rotina").checked, instituicoes: [...estado.instituicoes],
  });
}
function restaurarFiltros() {
  const f = lerLocal("radar.filtros", null);
  if (!f) return;
  $("f-prioridade").value = f.prioridade ?? "";
  $("f-periodo").value = f.periodo ?? "30";
  // Só restaura o setor se ele ainda existir nos dados.
  if ([...$("f-setor").options].some((o) => o.value === f.setor)) $("f-setor").value = f.setor;
  $("f-rotina").checked = f.rotina ?? true;
  for (const v of f.instituicoes || []) {
    const chip = document.querySelector(`.chip[data-valor="${CSS.escape(v)}"]`);
    if (chip) { estado.instituicoes.add(v); chip.setAttribute("aria-pressed", "true"); }
  }
}

function semAcento(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function filtrar() {
  const busca = semAcento($("f-busca").value.trim());
  const prio = $("f-prioridade").value;
  const tema = $("f-tema").value;
  const setor = $("f-setor").value;
  const tipo = $("f-tipo").value;
  const dias = $("f-periodo").value;
  const ocultarRotina = $("f-rotina").checked;
  const naoLidos = $("f-naolidos").checked;
  const limite = dias ? new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10) : "";
  const maxPrio = { urgente: 0, "alta+": 1, "media+": 2 }[prio] ?? 3;

  return estado.itens.filter((it) => {
    if (estado.somenteNovos && !ehNovo(it)) return false;
    if (PRIORIDADES[it.prioridade] > maxPrio) return false;
    if (estado.instituicoes.size && !estado.instituicoes.has(it.instituicao)) return false;
    if (tema && !(it.temas || []).includes(tema)) return false;
    if (setor && !(it.setores || []).includes(setor)) return false;
    if (tipo && it.tipo !== tipo) return false;
    if (limite && (it.data || "") < limite) return false;
    if (ocultarRotina && it.rotina && it.prioridade !== "urgente") return false;
    if (naoLidos && estado.lidos.has(it.id)) return false;
    if (busca && !semAcento(`${it.titulo} ${it.resumo} ${it.orgao} ${it.fonte}`).includes(busca)) return false;
    return true;
  });
}

// -------------------------------------------------------------- renderização --
function formatarData(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function render() {
  salvarFiltros();
  const visiveis = filtrar();
  const contagemPorPrio = (p) => estado.itens.filter((it) => it.prioridade === p).length;
  $("n-urgente").textContent = contagemPorPrio("urgente");
  $("n-alta").textContent = contagemPorPrio("alta");
  $("n-novos").textContent = estado.itens.filter(ehNovo).length;
  $("n-total").textContent = estado.itens.length;
  $("contagem").textContent = estado.somenteNovos
    ? `${visiveis.length} item(ns) novo(s) desde sua última visita`
    : `${visiveis.length} item(ns) com os filtros atuais`;

  const lista = $("lista");
  lista.replaceChildren();
  if (!visiveis.length) {
    const li = document.createElement("li");
    li.className = "vazio";
    li.textContent = estado.itens.length
      ? "Nenhum item com esses filtros. Experimente ampliar o período ou limpar os filtros."
      : "Ainda não há dados. Rode a primeira coleta.";
    lista.appendChild(li);
    return;
  }
  const tpl = $("tpl-item");
  const frag = document.createDocumentFragment();
  for (const it of visiveis.slice(0, 400)) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.classList.add(`p-${it.prioridade}`);
    if (estado.lidos.has(it.id)) el.classList.add("lido");
    if (ehNovo(it)) el.classList.add("e-novo");
    el.querySelector(".badge-prio").textContent = ROTULO_PRIORIDADE[it.prioridade];
    el.querySelector(".badge-inst").textContent = it.instituicao;
    el.querySelector(".item-tipo").textContent = it.tipo;
    const t = el.querySelector(".item-data");
    t.textContent = formatarData(it.data); t.dateTime = it.data;
    const a = el.querySelector(".item-titulo a");
    a.href = it.link; a.textContent = it.titulo;
    a.addEventListener("click", () => marcarLido(it.id, true, el));
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
    const btn = el.querySelector(".btn-lido");
    btn.textContent = estado.lidos.has(it.id) ? "Marcar como não lido" : "Marcar como lido";
    btn.addEventListener("click", () => marcarLido(it.id, !estado.lidos.has(it.id), el));
    frag.appendChild(el);
  }
  lista.appendChild(frag);
  if (visiveis.length > 400) {
    const li = document.createElement("li");
    li.className = "vazio";
    li.textContent = `Mostrando 400 de ${visiveis.length}. Refine os filtros para ver o restante.`;
    lista.appendChild(li);
  }
}

function marcarLido(id, lido, el) {
  lido ? estado.lidos.add(id) : estado.lidos.delete(id);
  gravarLocal("radar.lidos", [...estado.lidos]);
  el.classList.toggle("lido", lido);
  el.querySelector(".btn-lido").textContent = lido ? "Marcar como não lido" : "Marcar como lido";
}

// --------------------------------------------------------------- utilidades --
function mostrarStatus(status) {
  if (!status) { $("atualizado").textContent = "Sem informação de coleta"; return; }
  const quando = new Date(status.ultima_execucao);
  $("atualizado").textContent = "Última coleta: " + quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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

function configurarBotaoColeta() {
  let repo = CONFIG.repositorio;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!repo && m) repo = `${m[1]}/${location.pathname.split("/").filter(Boolean)[0] || ""}`;
  const btn = $("btn-coletar");
  if (repo && !repo.endsWith("/")) btn.href = `https://github.com/${repo}/actions/workflows/${CONFIG.arquivoWorkflow}`;
  else btn.hidden = true;
}

function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exportarCSV() {
  const cols = ["data", "prioridade", "instituicao", "tipo", "titulo", "setores", "temas", "motivo_urgencia", "orgao", "link"];
  const linhas = [cols.join(";")];
  for (const it of filtrar()) {
    linhas.push(cols.map((c) => {
      const v = Array.isArray(it[c]) ? it[c].join(", ") : it[c] ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(";"));
  }
  // BOM para o Excel abrir com acentos corretos.
  const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `radar-educacao-superior-${new Date().toISOString().slice(0, 10)}.csv`;
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
