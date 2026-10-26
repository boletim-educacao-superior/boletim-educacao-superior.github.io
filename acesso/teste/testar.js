// Testes do servidor de acesso (Acesso.gs) sem o Google: simula os serviços do Apps Script em Node.
// Rodar:  node acesso/teste/testar.js
"use strict";
const vm = require("vm");
const { novoAmbiente } = require("./ambiente");

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
  conferir("cabeçalho da Equipe", equipe[0].join() === "email,nome,admin,cadastrado_por,cadastrado_em,boasvindas_em,senha,senha_em,ultimo_acesso,visita_anterior,perfil,avisos_imediato,avisos_semanal", equipe[0]);
  conferir("Diego entra como administrador", equipe[1][0] === DIEGO && equipe[1][2] === true);
  const pasta = "1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe"; // PASTA_ID do Acesso.gs
  conferir("planilha vai para a pasta do Radar", a.pastas[a.props.PLANILHA_ID] === pasta, a.pastas);
  conferir("script vai para a pasta do Radar", a.pastas["script-radar"] === pasta, a.pastas);
  a.g.configurar();
  conferir("rodar de novo não duplica", a.aba("Equipe").length === 2);
  conferir("cria os gatilhos dos avisos uma vez só", a.gatilhos.length === 2
    && a.gatilhos.some((g) => g.funcao === "verificarAvisos" && g.minutos === 15)
    && a.gatilhos.some((g) => g.funcao === "resumoSemanal" && g.dia === "MONDAY" && g.hora === 8), a.gatilhos);
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
  conferir("e-mail de boas-vindas com o link e o passo a passo", bv && /Primeiro acesso/.test(bv.corpo) && /boletim-educacao-superior\.github\.io\//.test(bv.corpo));
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

cenario("Avisos por e-mail", (a) => {
  a.g.configurar();
  const adm = primeiroAcesso(a, DIEGO, SENHA).dados.sessao;
  a.api(adm, "salvarMembro", ANA, "Ana Teste", false, false);
  const ana = primeiroAcesso(a, ANA, "anaradar2026").dados.sessao;
  const item = (id, prioridade, visto) => ({ id, prioridade, visto_em: visto, data: visto.slice(0, 10), instituicao: "MEC",
    titulo: "Notícia " + id + " <b>", link: "https://www.gov.br/" + id, tipo: "Portaria", resumo: "Resumo",
    motivo_urgencia: prioridade === "urgente" ? "Mudança normativa" : "" });
  const U1 = "a".repeat(16), A1 = "b".repeat(16), U2 = "c".repeat(16), A2 = "d".repeat(16);
  a.avisos.itens = [item(U1, "urgente", "2026-10-20T07:00:00+00:00"), item(A1, "alta", "2026-10-20T07:00:00+00:00")];

  let r = a.api(ana, "perfil");
  conferir("perfil traz os avisos (nada escolhido)", r.ok && r.dados.avisos.imediato.length === 0 && r.dados.avisos.semanal.length === 0, r);
  r = a.api(ana, "salvarAvisos", ["urgente", "xss"], ["urgente", "alta"]);
  conferir("salva as escolhas e ignora prioridade inválida", r.ok && r.dados.avisos.imediato.join() === "urgente" && r.dados.avisos.semanal.join() === "urgente,alta", r);
  r = a.api(adm, "salvarAvisos", [], ["alta"]);
  conferir("cada pessoa escolhe a sua", r.ok && r.dados.avisos.semanal.join() === "alta");
  conferir("lista da equipe mostra os avisos de cada um", a.api(adm, "equipe").dados.find((p) => p.email === ANA).avisos.imediato.join() === "urgente");

  const antes = a.emails.length;
  a.g.verificarAvisos();
  conferir("primeira conferência só marca o ponto de partida (não manda o histórico)", a.emails.length === antes && a.props.AVISOS_ULTIMO === "2026-10-20T07:00:00+00:00", a.props.AVISOS_ULTIMO);
  conferir("lê o avisos.json do painel sem cache", /dados\/avisos\.json\?t=\d+$/.test(a.buscas[0] || ""), a.buscas);

  a.avisos.itens.push(item(U2, "urgente", "2026-10-26T07:00:00+00:00"), item(A2, "alta", "2026-10-26T07:00:00+00:00"));
  a.g.verificarAvisos();
  const novos = a.emails.slice(antes);
  conferir("coleta nova: aviso imediato só para quem pediu", novos.length === 1 && novos[0].para === ANA, novos.map((e) => e.para));
  conferir("o aviso traz só a prioridade escolhida e só o que é novo", novos[0] && /Notícia c{16}/.test(novos[0].corpo) && !/Notícia d{16}/.test(novos[0].corpo) && !/Notícia a{16}/.test(novos[0].corpo), novos[0] && novos[0].corpo);
  conferir("assunto diz o que chegou", novos[0] && /^Urgente: Notícia c{16}/.test(novos[0].assunto), novos[0] && novos[0].assunto);
  conferir("HTML escapa o título", novos[0] && /Notícia c{16} &lt;b&gt;/.test(novos[0].html) && novos[0].html.indexOf("c".repeat(16) + " <b>") < 0);
  a.g.verificarAvisos();
  conferir("sem coleta nova, não repete", a.emails.length === antes + 1);

  a.avancar(60 * 24 * 3);  // 26/10
  const antesSemana = a.emails.length;
  a.g.resumoSemanal();
  const semana = a.emails.slice(antesSemana);
  const daAna = semana.find((e) => e.para === ANA), doDiego = semana.find((e) => e.para === DIEGO);
  conferir("resumo semanal para quem pediu, com as prioridades de cada um", semana.length === 2 && daAna && doDiego, semana.map((e) => e.para));
  conferir("resumo da Ana: urgente e alta da semana", daAna && /Notícia a{16}/.test(daAna.corpo) && /Notícia d{16}/.test(daAna.corpo) && /Resumo da semana/.test(daAna.assunto), daAna && daAna.assunto);
  conferir("resumo do Diego: só alta", doDiego && /Notícia b{16}/.test(doDiego.corpo) && !/Notícia a{16}/.test(doDiego.corpo));

  a.avancar(60 * 24 * 14);  // duas semanas sem nada novo
  const antesVazio = a.emails.length;
  a.g.resumoSemanal();
  conferir("semana sem novidade: nenhum resumo", a.emails.length === antesVazio);

  // Notícia marcada como sem relevância pela equipe não vai no aviso.
  const U3 = "e".repeat(16);
  a.avisos.itens.push(item(U3, "urgente", "2026-11-09T07:00:00+00:00"));
  a.api(adm, "marcar", U3, "irrelevante", true, "fora do escopo", "T", "https://x");
  a.g.verificarAvisos();
  conferir("sem relevância não gera aviso", a.emails.length === antesVazio);

  // Cota: abaixo da reserva dos certificados, o aviso espera na fila.
  const U4 = "f".repeat(16);
  a.avisos.itens.push(item(U4, "urgente", "2026-11-09T08:00:00+00:00"));
  a.g.MailApp.cota = 30;
  a.g.verificarAvisos();
  conferir("sem cota: não envia e guarda na fila", a.emails.length === antesVazio && JSON.parse(a.props.AVISOS_FILA).length === 1, a.props.AVISOS_FILA);
  a.g.MailApp.cota = 100;
  a.g.verificarAvisos();
  conferir("com cota de volta: envia o que esperava", a.emails.length === antesVazio + 1 && /Notícia f{16}/.test(a.emails[a.emails.length - 1].corpo)
    && JSON.parse(a.props.AVISOS_FILA).length === 0);

  // Exemplo para mim
  r = a.api(ana, "testarAvisos");
  conferir("exemplo sai para a própria pessoa, marcado como exemplo", r.ok && a.emails[a.emails.length - 1].para === ANA && /^\[Exemplo\]/.test(a.emails[a.emails.length - 1].assunto), r);
  a.api(ana, "testarAvisos"); a.api(ana, "testarAvisos");
  r = a.api(ana, "testarAvisos");
  conferir("no máximo 3 exemplos por dia", !r.ok && /3 exemplos/.test(r.erro), r);

  // Parar de receber pelo link do e-mail
  const link = (a.emails.filter((e) => e.para === ANA).pop().corpo.match(/#parar-avisos=([A-Za-z0-9_-]+)/) || [])[1];
  conferir("rodapé tem o link para parar de receber, sem o e-mail", !!link && link.length === 32 && !/ana/i.test(link), link);
  r = a.chamar({ acao: "cancelarAvisos", chave: "x".repeat(32) });
  conferir("link inventado é recusado", !r.ok && /inválido/.test(r.erro), r);
  r = a.chamar({ acao: "cancelarAvisos", chave: link });
  conferir("link certo cancela todos os avisos da pessoa", r.ok && r.dados.nome === "Ana Teste"
    && a.api(ana, "perfil").dados.avisos.imediato.length === 0 && a.api(ana, "perfil").dados.avisos.semanal.length === 0, r);
  conferir("cancelamento entra no registro", a.aba("Registro").some((l) => l[2] === "avisos_cancelados" && l[1] === ANA));
  r = a.api(ana, "testarAvisos");
  conferir("sem nada escolhido, o exemplo pede para escolher", !r.ok && /Escolha pelo menos/.test(r.erro), r);
});

cenario("Modelos de e-mail", (a) => {
  a.g.configurar();
  const ultimo = (para) => a.emails.filter((e) => e.para === para).pop();
  a.chamar({ acao: "cadastrar", nome: "Nova Pessoa", email: "nova@exemplo.com" });
  let e = ultimo("nova@exemplo.com");
  conferir("cadastro novo: código com título de confirmação", e && /Confirme seu e-mail/.test(e.html) && /^\d{6} é o seu código/.test(e.assunto), e && e.assunto);
  a.avancar(2);
  a.chamar({ acao: "pedirCodigo", email: DIEGO });
  e = ultimo(DIEGO);
  conferir("primeiro acesso: código com título de criar senha", e && /Crie a sua senha/.test(e.html));
  primeiroAcesso(a, DIEGO, SENHA);
  a.avancar(2);
  a.chamar({ acao: "pedirCodigo", email: DIEGO });
  e = ultimo(DIEGO);
  conferir("esqueci a senha: código com título de troca", e && /Troque a sua senha/.test(e.html) && /sua senha continua a mesma/.test(e.corpo));
  conferir("todos no molde do Boletim (cabeçalho, endereço e CINEA)", a.emails.every((x) => /<h1/.test(x.html)
    && x.html.indexOf("boletim-educacao-superior.github.io") > 0 && /CINEA/.test(x.html)), a.emails.length);
});

console.log(`\n${total - falhas} de ${total} verificações passaram.`);
process.exit(falhas ? 1 : 0);
