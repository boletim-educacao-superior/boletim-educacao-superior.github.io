// Simulador do servidor de acesso, só para testar as telas no próprio computador:
//   http://localhost:8791/?acesso=simulado
// Não guarda nada de verdade. O código "enviado por e-mail" aparece no console do navegador.
// As regras de verdade (e seus testes) estão em acesso/Acesso.gs e acesso/teste/testar.js.
window.SimuladorAcesso = (() => {
  const agora = () => new Date().toISOString().replace("T", " ").slice(0, 19);
  const equipe = [
    { email: "diego.teste@exemplo.org", nome: "Diego Eduardo", admin: true, senha: "", cadastrado_em: agora(), ultimo_acesso: "" },
    { email: "ana.teste@pucminas.br", nome: "Ana Teste", admin: false, senha: "teste2026ok", cadastrado_em: agora(), ultimo_acesso: "" },
  ];
  const registro = [];
  let marcas = [];                 // { id, tipo, por, em, motivo }
  // Uso do painel: alguns acessos de exemplo (últimos 30 dias, mais em dias úteis de manhã) para o relatório ter o que mostrar.
  const eventos = [];
  for (let i = 0; i < 160; i++) {
    const d = new Date(Date.now() - Math.floor(Math.random() * 30) * 864e5);
    if ([0, 6].includes(d.getDay()) && Math.random() < 0.7) continue;
    d.setHours(Math.random() < 0.6 ? 8 + Math.floor(Math.random() * 4) : 13 + Math.floor(Math.random() * 6), 10);
    const equipe = Math.random() < 0.45;
    eventos.push({ quando: d.toLocaleString("sv-SE").slice(0, 19), visitante: "v" + (equipe ? "eq" : Math.floor(Math.random() * 40)),
                   email: equipe ? (Math.random() < 0.6 ? "diego.teste@exemplo.org" : "ana.teste@pucminas.br") : "",
                   tipo: "abertura", detalhe: "inicio", dispositivo: Math.random() < 0.3 ? "celular" : "computador" });
  }
  [["noticia", "MEC|urgente|Novo Marco Regulatório do EAD"], ["noticia", "INEP|alta|Enade 2027: inscrições"], ["noticia", "MEC|urgente|Novo Marco Regulatório do EAD"],
   ["busca", "marco regulatório"], ["busca", "enade"], ["visao", "sinalizadas"]].forEach(([tipo, detalhe]) =>
    eventos.push({ quando: agora(), visitante: "veq", email: "", tipo, detalhe, dispositivo: "computador" }));
  const lidos = new Map();         // id → { por, em } (da equipe)
  const codigos = {}, sessoes = {};
  let coletas = [];      // horários das atualizações manuais (simulado)
  const pessoais = [];  // { email, id, tipo, em }: marcações de quem tem perfil Usuário

  // O estado sobrevive a recarregar a página (entrar e sair recarregam), enquanto a aba estiver aberta.
  const CHAVE = "radar.simulador";
  try {
    const salvo = JSON.parse(sessionStorage.getItem(CHAVE) || "null");
    if (salvo) {
      equipe.splice(0, equipe.length, ...salvo.equipe);
      registro.splice(0, registro.length, ...salvo.registro);
      marcas = salvo.marcas;
      eventos.splice(0, eventos.length, ...salvo.eventos);
      salvo.lidos.forEach(([k, v]) => lidos.set(k, v));
      Object.assign(sessoes, salvo.sessoes);
      pessoais.splice(0, pessoais.length, ...(salvo.pessoais || []));
    }
  } catch { /* começa do zero */ }
  const salvar = () => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify({ equipe, registro, marcas, eventos, lidos: [...lidos], sessoes, pessoais })); } catch { /* cheio */ }
  };
  const quem = (s) => sessoes[s];
  const pessoa = (e) => equipe.find((p) => p.email === String(e).toLowerCase());
  const reg = (q, acao, detalhe = "") => registro.unshift({ quando: agora(), quem: q, acao, detalhe });
  const tipoDe = (p) => (p.admin ? "admin" : p.perfil === "usuario" ? "usuario" : "equipe");
  const perfil = (p) => ({ email: p.email, nome: p.nome, admin: p.admin, sistema: false, tipo: tipoDe(p), avisos: p.avisos || { imediato: [], semanal: [] }, cadastrado_em: p.cadastrado_em,
                           cadastrado_por: "Conta do sistema", senha_em: p.senha_em || "", ultimo_acesso: p.ultimo_acesso,
                           // Simulação: a "visita anterior" foi há 3 dias (para o cartão de novidades ter números)
                           visita_anterior: new Date(Date.now() - 3 * 864e5).toLocaleString("sv-SE").slice(0, 19) });
  const lista = () => equipe.map((p) => ({ ...p, senha: undefined, tem_senha: !!p.senha, perfil: p.perfil === "usuario" ? "usuario" : "equipe" }));
  const sessaoNova = (p) => { const s = crypto.randomUUID(); sessoes[s] = p.email; return { sessao: s, perfil: perfil(p) }; };
  const falha = (erro) => ({ ok: false, erro });
  const validarSenha = (s) => (s.length < 8 ? "A senha precisa ter pelo menos 8 caracteres." : !/\d/.test(s) || !/[a-z]/i.test(s) ? "Use letras e números na senha." : "");

  const acoes = {
    pedirCodigo({ email }) {
      const p = pessoa(email);
      if (!p) return falha("Este e-mail não está cadastrado no Boletim. Confira se digitou certo ou peça acesso a um administrador.");
      codigos[p.email] = String(Math.floor(100000 + Math.random() * 900000));
      console.info(`[simulador] código para ${p.email}: ${codigos[p.email]}`);
      return { ok: true, dados: { ok: true } };
    },
    definirSenha({ email, codigo, senha }) {
      const p = pessoa(email);
      if (!p || codigos[p.email] !== codigo) return falha("Código incorreto. Restam 4 tentativas.");
      const e = validarSenha(senha); if (e) return falha(e);
      delete codigos[p.email]; p.senha = senha; p.senha_em = agora(); reg(p.email, "senha_criada");
      return { ok: true, dados: sessaoNova(p) };
    },
    entrar({ email, senha }) {
      const p = pessoa(email);
      if (p && !p.senha) return falha('Você ainda não criou sua senha. Clique em "Primeiro acesso" para receber um código por e-mail.');
      if (!p || p.senha !== senha) return falha("E-mail ou senha incorretos.");
      reg(p.email, "entrada"); return { ok: true, dados: sessaoNova(p) };
    },
    sair({ sessao }) { delete sessoes[sessao]; return { ok: true, dados: true }; },
    api({ nome, sessao, args }) {
      const p = pessoa(quem(sessao) || "");
      if (!p || !p.senha) return falha("SESSAO_INVALIDA");
      const admin = () => { if (!p.admin) throw new Error("Só administradores podem fazer isso."); };
      const f = {
        perfil: () => { p.ultimo_acesso = agora(); return perfil(p); },
        salvarMeuNome: (nome) => {
          nome = String(nome || "").replace(/\s+/g, " ").trim();
          if (!nome) throw new Error("Digite o seu nome.");
          reg(p.email, "nome_alterado", p.nome + " → " + nome); p.nome = nome; return perfil(p);
        },
        alterarSenha: (atual, nova) => {
          if (atual !== p.senha) throw new Error("A senha atual não confere.");
          const e = validarSenha(nova); if (e) throw new Error(e);
          p.senha = nova; reg(p.email, "senha_alterada"); return sessaoNova(p);
        },
        equipe: () => { admin(); return lista(); },
        salvarAvisos: (imediato, semanal) => {
          const so = (l) => ["urgente", "alta"].filter((x) => (l || []).includes(x));
          p.avisos = { imediato: so(imediato), semanal: so(semanal) };
          reg(p.email, "avisos_alterados", JSON.stringify(p.avisos));
          return perfil(p);
        },
        testarAvisos: () => {
          const a = p.avisos || { imediato: [], semanal: [] };
          if (!a.imediato.length && !a.semanal.length) throw new Error("Escolha pelo menos um aviso e salve antes de pedir o exemplo.");
          reg(p.email, "aviso_exemplo", "(simulado: nenhum e-mail sai)");
          return { para: p.email, itens: 3 };
        },
        // Atualizar agora: 2 por hora; não dispara nada de verdade (a coleta "termina" quando o status.json mudar).
        coletarAgora: () => {
          admin();
          const agora = Date.now();
          coletas = coletas.filter((t) => agora - t < 3600e3);
          const hm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
          if (coletas.length >= 2) throw new Error(`As notícias já foram atualizadas 2 vezes na última hora. Tente de novo a partir das ${hm(coletas[0] + 3600e3)}.`);
          coletas.push(agora);
          reg(p.email, "coleta_manual", "Pediu para atualizar as notícias agora");
          return { restantes: 2 - coletas.length, libera_as: coletas.length >= 2 ? hm(coletas[0] + 3600e3) : "", configurado: true,
                   pedido_em: new Date(agora - 30 * 864e5).toISOString() };  // simulado: qualquer status.json já "chegou"
        },
        situacaoColeta: () => { admin(); return { restantes: 2 - coletas.filter((t) => Date.now() - t < 3600e3).length, configurado: true }; },
        salvarAvisosDe: (email, imediato, semanal) => {
          admin();
          const m = pessoa(email);
          if (!m) throw new Error("Pessoa não encontrada.");
          const so = (l) => ["urgente", "alta"].filter((x) => (l || []).includes(x));
          m.avisos = { imediato: so(imediato), semanal: so(semanal) };
          m.avisos_por = m.avisos.imediato.length || m.avisos.semanal.length ? p.nome : "";
          reg(p.email, "avisos_de_outro", email);
          return lista();
        },
        salvarMembro: (email, nome, adm, boas, perf, avisos) => {
          admin(); email = String(email).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) throw new Error("Digite um e-mail válido.");
          const m = pessoa(email);
          if (m) { m.nome = nome; m.admin = adm; if (perf) m.perfil = perf === "usuario" ? "usuario" : ""; if (m.perfil === "usuario") m.admin = false; reg(p.email, "membro_alterado", email); }
          else { equipe.push({ email, nome, admin: adm, senha: "", cadastrado_em: agora(), ultimo_acesso: "", boasvindas_em: boas ? agora() : "", avisos: avisos || { imediato: [], semanal: [] }, avisos_por: avisos && (avisos.imediato.length || avisos.semanal.length) ? p.nome : "" }); reg(p.email, "membro_cadastrado", email); }
          return lista();
        },
        removerMembro: (email) => { admin(); equipe.splice(equipe.indexOf(pessoa(email)), 1); reg(p.email, "membro_removido", email); return lista(); },
        apagarSenha: (email) => { admin(); pessoa(email).senha = ""; reg(p.email, "senha_apagada", email); return lista(); },
        enviarBoasVindas: (email) => { admin(); pessoa(email).boasvindas_em = agora(); reg(p.email, "boasvindas_enviado", email); return lista(); },
        registro: () => { admin(); return registro; },
        uso: (dias) => {
          admin();
          const ini = new Date(Date.now() - (dias - 1) * 864e5).toLocaleString("sv-SE").slice(0, 10);
          const ev = eventos.filter((e) => e.quando.slice(0, 10) >= ini);
          const ab = ev.filter((e) => e.tipo === "abertura");
          const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
          ab.forEach((e) => { const d = new Date(e.quando.replace(" ", "T")); calor[d.getDay()][d.getHours()]++; });
          const top = (lista, chave) => { const c = {}; lista.forEach((x) => { const k = chave(x); c[k] = c[k] || { chave: k, n: 0 }; c[k].n++; }); return Object.values(c).sort((a, b) => b.n - a.n).slice(0, 10); };
          const serie = Array.from({ length: dias }, (_, i) => {
            const dia = new Date(Date.now() - (dias - 1 - i) * 864e5).toLocaleString("sv-SE").slice(0, 10);
            const doDia = ab.filter((e) => e.quando.startsWith(dia));
            return { dia, equipe: doDia.filter((e) => e.email).length, publico: doDia.filter((e) => !e.email).length };
          });
          const eq = ab.filter((e) => e.email);
          return {
            dias, aberturas: ab.length, aberturas_equipe: eq.length, aberturas_publico: ab.length - eq.length,
            aberturas_usuarios: 0, pessoas_usuarios: 0, cadastros_novos: equipe.filter((x) => x.perfil === "usuario").length,
            total_usuarios: equipe.filter((x) => x.perfil === "usuario").length,
            visitantes: new Set(ab.map((e) => e.visitante)).size, visitantes_publico: new Set(ab.filter((e) => !e.email).map((e) => e.visitante)).size,
            pessoas_equipe: new Set(eq.map((e) => e.email)).size, noticias_abertas: ev.filter((e) => e.tipo === "noticia").length,
            csv: ev.filter((e) => e.tipo === "csv").length,
            dispositivos: { celular: ab.filter((e) => e.dispositivo === "celular").length, computador: ab.filter((e) => e.dispositivo !== "celular").length },
            calor, serie,
            equipe: top(eq, (e) => e.email).map((x) => ({ ...x, nome: (pessoa(x.chave) || {}).nome || x.chave, ultimo: eq.filter((e) => e.email === x.chave).map((e) => e.quando).sort().pop() })),
            visoes: top(ev.filter((e) => e.tipo === "visao"), (e) => e.detalhe),
            instituicoes: top(ev.filter((e) => e.tipo === "noticia"), (e) => e.detalhe.split("|")[0]),
            noticias: top(ev.filter((e) => e.tipo === "noticia"), (e) => e.detalhe.split("|").slice(2).join("|")).map((x) => ({ ...x, instituicao: "MEC" })),
            buscas: top(ev.filter((e) => e.tipo === "busca"), (e) => e.detalhe),
          };
        },
        marcacoes: () => (tipoDe(p) === "usuario" ? doUsuario() : {
          marcas: marcas.map((m) => ({ ...m, nome: (pessoa(m.por) || {}).nome || m.por })),
          lidos: [...lidos].map(([id, l]) => ({ id, ...l, nome: (pessoa(l.por) || {}).nome || l.por })),
        }),
        marcar: (id, tipo, ativo, motivo, titulo) => {
          if (tipoDe(p) === "usuario") {
            if (tipo !== "sinalizada") throw new Error("Só a equipe do CINEA marca notícias como sem relevância.");
            pessoal(id, "sinalizada", ativo);
            return doUsuario().marcas;
          }
          marcas = marcas.filter((m) => !(m.id === id && (m.tipo === tipo || ativo)));
          if (ativo) marcas.push({ id, tipo, por: p.email, em: agora(), motivo: motivo || "" });
          reg(p.email, ativo ? "item_" + tipo : "item_" + tipo + "_desfeito", titulo);
          return marcas.map((m) => ({ ...m, nome: (pessoa(m.por) || {}).nome || m.por }));
        },
        marcarLidos: (ids, lido) => {
          if (tipoDe(p) === "usuario") { ids.forEach((i) => pessoal(i, "lida", lido)); return true; }
          ids.forEach((i) => (lido ? (lidos.has(i) || lidos.set(i, { por: p.email, em: agora() })) : lidos.delete(i)));
          return true;
        },
      }[nome];
      function pessoal(id, t, ativo) {
        const i = pessoais.findIndex((x) => x.email === p.email && x.id === id && x.tipo === t);
        if (ativo && i < 0) pessoais.push({ email: p.email, id, tipo: t, em: agora() });
        if (!ativo && i >= 0) pessoais.splice(i, 1);
      }
      function doUsuario() {
        const meus = pessoais.filter((x) => x.email === p.email);
        return {
          marcas: meus.filter((x) => x.tipo === "sinalizada").map((x) => ({ id: x.id, tipo: "sinalizada", por: p.email, nome: p.nome, em: x.em, pessoal: true }))
            .concat(marcas.filter((m) => m.tipo === "irrelevante").map((m) => ({ id: m.id, tipo: "irrelevante" }))),
          lidos: meus.filter((x) => x.tipo === "lida").map((x) => ({ id: x.id, por: p.email, nome: p.nome, em: x.em })),
          pessoal: true,
        };
      }
      if (!f) return falha("Ação desconhecida.");
      try { return { ok: true, dados: f(...(args || [])) }; } catch (e) { return falha(e.message); }
    },
  };

  acoes.cadastrar = ({ nome, email }) => {
    email = String(email || "").toLowerCase();
    const p = pessoa(email);
    if (p && p.senha) return falha('Este e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".');
    if (String(nome || "").trim().length < 3) return falha("Digite seu nome.");
    if (!p) { equipe.push({ email, nome: nome.trim(), admin: false, senha: "", perfil: "usuario", cadastrado_em: agora(), ultimo_acesso: "" }); reg(email, "autocadastro", email); }
    return acoes.pedirCodigo({ email });
  };
  acoes.cancelarAvisos = ({ chave }) => {
    if (!/^[A-Za-z0-9_-]{32}$/.test(chave || "")) return falha("Link inválido. Para mudar os avisos, entre e abra \"Meu perfil\".");
    const p = equipe.find((x) => x.avisos && (x.avisos.imediato.length || x.avisos.semanal.length));
    if (!p) return falha("Link inválido ou de uma conta que não existe mais.");
    p.avisos = { imediato: [], semanal: [] };
    return { ok: true, dados: { nome: p.nome } };
  };
  acoes.publico = () => ({ ok: true, dados: { irrelevantes: marcas.filter((m) => m.tipo === "irrelevante").map((m) => m.id) } });
  acoes.evento = (c) => {
    const sessao = c.sessao && sessoes[c.sessao];
    eventos.push({ quando: agora(), visitante: c.visitante, email: sessao || "", tipo: c.tipo, detalhe: c.detalhe || "", dispositivo: c.dispositivo });
    return { ok: true, dados: true };
  };

  return {
    chamar: async (corpo) => {
      await new Promise((r) => setTimeout(r, 250)); // parece uma chamada de rede
      const r = (acoes[corpo.acao] || (() => falha("Ação desconhecida.")))(corpo);
      salvar();
      return r;
    },
  };
})();
