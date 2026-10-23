// Simulador do servidor de acesso, só para testar as telas no próprio computador:
//   http://localhost:8791/?acesso=simulado
// Não guarda nada de verdade. O código "enviado por e-mail" aparece no console do navegador.
// As regras de verdade (e seus testes) estão em acesso/Acesso.gs e acesso/teste/testar.js.
window.SimuladorAcesso = (() => {
  const agora = () => new Date().toISOString().replace("T", " ").slice(0, 19);
  const equipe = [
    { email: "diegoeduardo@pucminas.br", nome: "Diego Eduardo", admin: true, senha: "", cadastrado_em: agora(), ultimo_acesso: "" },
    { email: "ana.teste@pucminas.br", nome: "Ana Teste", admin: false, senha: "teste2026ok", cadastrado_em: agora(), ultimo_acesso: "" },
  ];
  const registro = [];
  const codigos = {}, sessoes = {};
  const quem = (s) => sessoes[s];
  const pessoa = (e) => equipe.find((p) => p.email === String(e).toLowerCase());
  const reg = (q, acao, detalhe = "") => registro.unshift({ quando: agora(), quem: q, acao, detalhe });
  const perfil = (p) => ({ email: p.email, nome: p.nome, admin: p.admin });
  const lista = () => equipe.map((p) => ({ ...p, senha: undefined, tem_senha: !!p.senha }));
  const sessaoNova = (p) => { const s = crypto.randomUUID(); sessoes[s] = p.email; return { sessao: s, perfil: perfil(p) }; };
  const falha = (erro) => ({ ok: false, erro });
  const validarSenha = (s) => (s.length < 8 ? "A senha precisa ter pelo menos 8 caracteres." : !/\d/.test(s) || !/[a-z]/i.test(s) ? "Use letras e números na senha." : "");

  const acoes = {
    pedirCodigo({ email }) {
      const p = pessoa(email);
      if (!p) return falha("Este e-mail não está cadastrado no Radar. Confira se digitou certo ou peça acesso a um administrador.");
      codigos[p.email] = String(Math.floor(100000 + Math.random() * 900000));
      console.info(`[simulador] código para ${p.email}: ${codigos[p.email]}`);
      return { ok: true, dados: { ok: true } };
    },
    definirSenha({ email, codigo, senha }) {
      const p = pessoa(email);
      if (!p || codigos[p.email] !== codigo) return falha("Código incorreto. Restam 4 tentativas.");
      const e = validarSenha(senha); if (e) return falha(e);
      delete codigos[p.email]; p.senha = senha; reg(p.email, "senha_criada");
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
        alterarSenha: (atual, nova) => {
          if (atual !== p.senha) throw new Error("A senha atual não confere.");
          const e = validarSenha(nova); if (e) throw new Error(e);
          p.senha = nova; reg(p.email, "senha_alterada"); return sessaoNova(p);
        },
        equipe: () => { admin(); return lista(); },
        salvarMembro: (email, nome, adm, boas) => {
          admin(); email = String(email).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) throw new Error("Digite um e-mail válido.");
          const m = pessoa(email);
          if (m) { m.nome = nome; m.admin = adm; reg(p.email, "membro_alterado", email); }
          else { equipe.push({ email, nome, admin: adm, senha: "", cadastrado_em: agora(), ultimo_acesso: "", boasvindas_em: boas ? agora() : "" }); reg(p.email, "membro_cadastrado", email); }
          return lista();
        },
        removerMembro: (email) => { admin(); equipe.splice(equipe.indexOf(pessoa(email)), 1); reg(p.email, "membro_removido", email); return lista(); },
        apagarSenha: (email) => { admin(); pessoa(email).senha = ""; reg(p.email, "senha_apagada", email); return lista(); },
        enviarBoasVindas: (email) => { admin(); pessoa(email).boasvindas_em = agora(); reg(p.email, "boasvindas_enviado", email); return lista(); },
        registro: () => { admin(); return registro; },
      }[nome];
      if (!f) return falha("Ação desconhecida.");
      try { return { ok: true, dados: f(...(args || [])) }; } catch (e) { return falha(e.message); }
    },
  };

  return {
    chamar: async (corpo) => {
      await new Promise((r) => setTimeout(r, 250)); // parece uma chamada de rede
      return (acoes[corpo.acao] || (() => falha("Ação desconhecida.")))(corpo);
    },
  };
})();
