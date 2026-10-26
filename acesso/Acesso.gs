/**
 * Servidor de acesso do Radar da Educação Superior (CINEA / NED · PUC Minas).
 *
 * Implantar como App da Web: Executar como "Eu" (cineaned@gmail.com), Quem pode acessar "Qualquer pessoa".
 * O painel (GitHub Pages) conversa com este servidor por POST, sempre com { acao, ... } em JSON.
 *
 * Mesma lógica do Painel de certificados: equipe numa planilha, código de 6 dígitos por e-mail, sessão de 30 dias
 * guardada no navegador e, no servidor, só como hash. Diferença: aqui a pessoa cria uma SENHA (com o código) e
 * depois entra com e-mail e senha; o código só volta a ser usado no primeiro acesso e em "Esqueci a senha".
 *
 * ATENÇÃO: este arquivo fica num repositório PÚBLICO. Não escreva segredos aqui. O segredo usado nos hashes é
 * criado por configurar() e fica só nas propriedades do script.
 */

const CONTA_SISTEMA = 'cineaned@gmail.com';   // dona do script: sempre administradora
const ENDERECO_PAINEL = 'https://boletim-educacao-superior.github.io/';
// Domínio próprio desde 26/10/2026 (organização boletim-educacao-superior). Os endereços antigos em
// certificacao-cinea.github.io (…/radar-educacao-superior/ e …/boletim-educacao-superior/) redirecionam para este.
const NOME_SISTEMA = 'Boletim da Educação Superior';
const REMETENTE = 'Boletim · CINEA | PUC Minas';
const NOME_PLANILHA = 'Radar da Educação Superior - Acesso (não mexer)';
// Pasta "Radar da Educação Superior" no Drive da cineaned: tudo do Radar no Google fica nela (script e planilha).
const PASTA_ID = '1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe';
// Cadastrados como administradores na primeira execução de configurar().
const ADMINS_INICIAIS = [{ email: 'diegoeduardo@pucminas.br', nome: 'Diego Eduardo' }];

const ABAS = {
  // senha = hash (nunca a senha); senha_em = quando foi criada ou trocada
  // visita_anterior = início da visita passada (para "novos desde a sua última visita")
  // avisos_imediato / avisos_semanal = prioridades escolhidas em "Meu perfil" para os avisos por e-mail ("urgente,alta")
  // perfil: em branco = equipe do CINEA (cadastrada pelo admin); 'usuario' = criou a própria conta (cadastro aberto).
  Equipe: ['email', 'nome', 'admin', 'cadastrado_por', 'cadastrado_em', 'boasvindas_em', 'senha', 'senha_em', 'ultimo_acesso',
           'visita_anterior', 'perfil', 'avisos_imediato', 'avisos_semanal'],
  Registro: ['quando', 'quem', 'acao', 'detalhe'],
  // Marcações da equipe (compartilhadas): notícia sinalizada ou sem relevância, com quem marcou e por quê
  Marcacoes: ['item_id', 'tipo', 'por', 'em', 'motivo', 'titulo', 'link'],
  // Notícias lidas pela equipe (compartilhado): quem leu primeiro e quando. Uma linha por notícia.
  Lidos: ['email', 'item_id', 'em'],
  // Uso do painel (aberto a qualquer pessoa): um visitante anônimo por navegador; e-mail só de quem entrou.
  // Nenhum dado pessoal de quem não entrou (sem IP, sem nome). tipo: abertura, visao, noticia, busca, csv.
  Acessos: ['quando', 'visitante', 'email', 'tipo', 'detalhe', 'dispositivo'],
  // Marcações pessoais de quem tem perfil Usuário (só ela vê): tipo sinalizada ou lida.
  Pessoais: ['email', 'item_id', 'tipo', 'em']
};

/** Linha nova da Equipe na ordem das colunas (a planilha pode ganhar colunas novas no fim). */
function linhaEquipe_(dados) {
  return linha_(ABAS.Equipe.map(function (c) { return dados[c] === undefined ? '' : dados[c]; }));
}

const DIA_MS = 24 * 60 * 60 * 1000;
const SESSAO_DIAS = 30;               // sem usar por 30 dias, pede a senha de novo
const CODIGO_MINUTOS = 15;            // validade do código
const CODIGO_TENTATIVAS = 5;          // erros permitidos por código
const CODIGOS_POR_HORA = 5;           // pedidos de código por e-mail na hora
const CODIGOS_POR_EMAIL_DIA = 10;     // pedidos de código por e-mail no dia
const CODIGOS_POR_DIA = 20;           // e-mails de código no dia, somando todos
// A cota de e-mails (100/dia) é a MESMA do sistema de certificados (mesma conta). Abaixo disto, o Radar não manda nada.
const RESERVA_CERTIFICADOS = 30;
const SENHA_ERROS_BLOQUEIO = 5;       // senhas erradas seguidas antes de bloquear o e-mail por um tempo
const SENHA_BLOQUEIO_MIN = 15;
const ERROS_POR_EMAIL_DIA = 20;       // senhas ou códigos errados por e-mail no dia
const RECUSAS_REGISTRADAS_DIA = 20;   // tentativas de quem não é da equipe que entram no registro
const SENHA_MIN = 8;
const SENHA_ITERACOES = 500;          // repetições do HMAC (2000 deixava a entrada lenta no Apps Script; senhas antigas guardam o próprio número)
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;   // conferido depois de passar para minúsculas
const SESSAO_INVALIDA = 'SESSAO_INVALIDA';

/** Erro com mensagem para a pessoa ler na tela. Qualquer outro erro vira "Erro no servidor" (detalhe só no log). */
function falha_(mensagem) { const e = new Error(mensagem); e.paraUsuario = true; return e; }

// ======================================================================== configuração --

/**
 * Rodar UMA vez no editor, logado como cineaned: cria a planilha, o segredo e os administradores iniciais,
 * guarda o script e a planilha na pasta do Radar, autoriza o envio de e-mail e cria os gatilhos dos avisos por e-mail
 * (verificarAvisos a cada 15 min e resumoSemanal às segundas). Pode rodar de novo sem estragar nada.
 */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SEGREDO')) props.setProperty('SEGREDO', Utilities.getUuid() + Utilities.getUuid());
  let id = props.getProperty('PLANILHA_ID');
  if (!id) {
    const ss = SpreadsheetApp.create(NOME_PLANILHA);
    id = ss.getId();
    props.setProperty('PLANILHA_ID', id);
    ss.getSheets()[0].setName('Equipe');
  }
  const pasta = DriveApp.getFolderById(PASTA_ID);
  [id, ScriptApp.getScriptId()].forEach(function (arquivo) {
    const f = DriveApp.getFileById(arquivo);
    if (!f.getParents().hasNext() || f.getParents().next().getId() !== PASTA_ID) f.moveTo(pasta);
  });
  const ss = planilha_();
  const equipe = lerAba_(ss, 'Equipe');
  lerAba_(ss, 'Registro');
  ADMINS_INICIAIS.forEach(function (a) {
    if (equipe.linhas.some(function (p) { return p.email === a.email; })) return;
    equipe.sh.appendRow(linhaEquipe_({ email: a.email, nome: a.nome, admin: true, cadastrado_por: CONTA_SISTEMA, cadastrado_em: agora_() }));
  });
  instalarGatilhos_();
  Logger.log('Pronto. Pasta: ' + pasta.getUrl() + ' · Planilha: ' + ss.getUrl() +
             ' · e-mails que ainda podem sair hoje: ' + MailApp.getRemainingDailyQuota());
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function segredo_() {
  const s = prop_('SEGREDO');
  if (!s) throw falha_('Servidor não configurado. Rode configurar() no editor.');
  return s;
}
function planilha_() {
  const id = prop_('PLANILHA_ID');
  if (!id) throw falha_('Servidor não configurado. Rode configurar() no editor.');
  return SpreadsheetApp.openById(id);
}

// ===================================================================== planilha (igual ao Base.gs dos certificados) --

function lerAba_(ss, nome) {
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold');
  const vals = sh.getDataRange().getValues();
  const cab = vals.shift().map(String);
  const faltam = ABAS[nome].filter(function (c) { return cab.indexOf(c) < 0; });
  if (faltam.length) {
    sh.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
    faltam.forEach(function (c) { cab.push(c); });
  }
  return {
    sh: sh,
    cab: cab,
    linhas: vals.map(function (v, i) {
      const o = { _linha: i + 2 };
      cab.forEach(function (c, j) { o[c] = texto_(v[j]); });
      return o;
    })
  };
}
function texto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
  return v === null || v === undefined ? '' : String(v).trim();
}
/** Texto que começa com = + - @ viraria fórmula na planilha: o apóstrofo guarda como texto puro. */
function celula_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function linha_(valores) { return valores.map(celula_); }
function salvarCampos_(tab, obj, campos) {
  campos.forEach(function (c) {
    tab.sh.getRange(obj._linha, tab.cab.indexOf(c) + 1).setValue(celula_(obj[c] === undefined ? '' : obj[c]));
  });
}
function agora_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss'); }
function verdadeiro_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// ==================================================================== registro --

let USUARIO_ATUAL_ = '';
function registrar_(ss, acao, detalhe) {
  try {
    lerAba_(ss, 'Registro').sh.appendRow(linha_([agora_(), USUARIO_ATUAL_ || 'desconhecido', acao, String(detalhe || '').slice(0, 1000)]));
  } catch (e) { /* registro é auxiliar: nunca trava a ação */ }
}

// ==================================================================== equipe --

function membro_(ss, email) {
  const tab = lerAba_(ss, 'Equipe');
  return { tab: tab, p: tab.linhas.filter(function (x) { return x.email.toLowerCase() === email; })[0] || null };
}
function ehAdmin_(ss, email) {
  if (email === CONTA_SISTEMA) return true;
  const m = membro_(ss, email).p;
  return !!m && verdadeiro_(m.admin);
}
function podeEntrar_(ss, email) { return email === CONTA_SISTEMA || !!membro_(ss, email).p; }

/**
 * Tipo de pessoa: 'admin' (administra), 'equipe' (equipe do CINEA, cadastrada pelo admin: marca para todos)
 * ou 'usuario' (criou a própria conta: marcações só dela). A conta do sistema é sempre admin.
 */
function tipoDe_(ss, email) {
  if (email === CONTA_SISTEMA) return 'admin';
  const m = membro_(ss, email).p;
  if (!m) return '';
  if (verdadeiro_(m.admin)) return 'admin';
  return m.perfil === 'usuario' ? 'usuario' : 'equipe';
}

/** A conta do sistema não está na planilha: guarda a senha dela nas propriedades. */
function senhaDe_(ss, email) {
  if (email === CONTA_SISTEMA) return { senha: prop_('SENHA_SISTEMA') || '', senha_em: prop_('SENHA_SISTEMA_EM') || '' };
  const m = membro_(ss, email);
  return m.p ? { senha: m.p.senha, senha_em: m.p.senha_em, tab: m.tab, p: m.p } : null;
}
function gravarSenha_(ss, email, hash) {
  const quando = agora_();
  if (email === CONTA_SISTEMA) {
    PropertiesService.getScriptProperties().setProperties({ SENHA_SISTEMA: hash, SENHA_SISTEMA_EM: quando });
    return hash;
  }
  const m = membro_(ss, email);
  m.p.senha = hash; m.p.senha_em = quando;
  salvarCampos_(m.tab, m.p, ['senha', 'senha_em']);
  return hash;
}
/** Versão da senha guardada na sessão: muda a cada troca (o sal é novo), então sessões antigas caem. */
function versaoSenha_(hash) { return hmac_('versao|' + hash).slice(0, 22); }

// ===================================================================== senhas --

function bytes_(t) { return Utilities.newBlob(String(t)).getBytes(); }
function hmac_(t) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(t), segredo_())); }

/** Hash da senha: sal próprio + segredo do servidor + HMAC repetido. Formato: v1$iterações$sal$hash. */
function hashSenha_(senha, sal, iteracoes) {
  sal = sal || Utilities.getUuid().replace(/-/g, '');
  iteracoes = iteracoes || SENHA_ITERACOES;
  const chave = bytes_(segredo_() + '|' + sal);
  let h = bytes_(senha);
  for (let i = 0; i < iteracoes; i++) h = Utilities.computeHmacSha256Signature(h, chave);
  return 'v1$' + iteracoes + '$' + sal + '$' + Utilities.base64EncodeWebSafe(h);
}
function senhaConfere_(senha, guardado) {
  const p = String(guardado || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') return false;
  const calc = hashSenha_(senha, p[2], parseInt(p[1], 10));
  let dif = calc.length ^ guardado.length;  // comparação sem atalho (tempo igual para acerto parcial)
  for (let i = 0; i < Math.min(calc.length, guardado.length); i++) dif |= calc.charCodeAt(i) ^ guardado.charCodeAt(i);
  return dif === 0;
}
function validarSenhaNova_(senha, email) {
  senha = String(senha || '');
  if (senha.length < SENHA_MIN) throw falha_('A senha precisa ter pelo menos ' + SENHA_MIN + ' caracteres.');
  if (senha.length > 200) throw falha_('A senha pode ter no máximo 200 caracteres.');
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) throw falha_('Use letras e números na senha.');
  const usuario = email.split('@')[0];
  if (usuario.length >= 4 && senha.toLowerCase().indexOf(usuario) >= 0) throw falha_('A senha não pode conter o seu e-mail.');
  return senha;
}

// ===================================================================== limites --

/** Contadores do dia (não somem como o cache). Só existe a chave do dia; as anteriores são apagadas. */
function limitesDoDia_() {
  const props = PropertiesService.getScriptProperties(), chave = 'limites:' + agora_().slice(0, 10);
  let l = null;
  try { l = JSON.parse(props.getProperty(chave) || 'null'); } catch (e) { /* recomeça */ }
  return {
    dados: Object.assign({ codigos: 0, recusas: 0, cadastros: 0, e: {} }, l || {}),
    doEmail: function (em) { const d = this.dados; d.e[em] = d.e[em] || { c: 0, f: 0 }; return d.e[em]; },
    salvar: function () {
      Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('limites:') === 0 && k !== chave) props.deleteProperty(k); });
      props.setProperty(chave, JSON.stringify(this.dados));
    }
  };
}

/** Um pedido de entrada por vez: impede chutar várias senhas ou códigos ao mesmo tempo. */
function comTrava_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw falha_('O sistema está ocupado. Tente de novo em alguns segundos.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function emailLimpo_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw falha_('Digite um e-mail válido.');
  return email;
}

// ======================================================================= código --

/**
 * Manda o código de 6 dígitos (primeiro acesso ou esqueci a senha). Quem não está na equipe recebe o aviso
 * na hora, como nos certificados (poucas pessoas usam; evita esperar um código que não vem).
 */
function pedirCodigo_(email) {
  const cache = CacheService.getScriptCache();
  if (cache.get('codigo-recente:' + email)) throw falha_('Aguarde um minuto antes de pedir outro código.');
  const nHora = parseInt(cache.get('codigos-hora:' + email), 10) || 0;
  if (nHora >= CODIGOS_POR_HORA) throw falha_('Muitos pedidos de código para este e-mail. Tente de novo daqui a uma hora.');
  const lim = limitesDoDia_(), meu = lim.doEmail(email);
  if (meu.f >= ERROS_POR_EMAIL_DIA) throw falha_('Muitas tentativas erradas hoje para este e-mail. Tente de novo amanhã.');
  if (meu.c >= CODIGOS_POR_EMAIL_DIA) throw falha_('Muitos pedidos de código hoje para este e-mail. Tente de novo amanhã.');
  cache.put('codigos-hora:' + email, String(nHora + 1), 60 * 60);

  const ss = planilha_();
  USUARIO_ATUAL_ = email;
  if (!podeEntrar_(ss, email)) {
    if (lim.dados.recusas++ < RECUSAS_REGISTRADAS_DIA) registrar_(ss, 'entrada_recusada', 'Pediu código, mas o e-mail não está na equipe');
    lim.salvar();
    throw falha_('Este e-mail não está cadastrado no Boletim. Confira se digitou certo ou peça acesso a um administrador.');
  }
  cache.put('codigo-recente:' + email, '1', 60);
  meu.c++;
  if (lim.dados.codigos >= CODIGOS_POR_DIA || MailApp.getRemainingDailyQuota() <= RESERVA_CERTIFICADOS) {
    lim.salvar();
    throw falha_('O limite de e-mails de hoje do sistema foi atingido. Tente amanhã ou fale com um administrador.');
  }
  lim.dados.codigos++;
  lim.salvar();
  const codigo = ('00000' + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000)).slice(-6);
  cache.put('codigo:' + email, JSON.stringify({ h: hmac_(email + '|' + codigo), erros: 0 }), CODIGO_MINUTOS * 60);
  const sen = senhaDe_(ss, email) || {}, quem = membro_(ss, email).p;
  const motivo = sen.senha ? 'senha' : quem && quem.cadastrado_por === 'autocadastro' ? 'cadastro' : 'primeiro';
  enviarEmail_(email, emailCodigo_(motivo, quem ? quem.nome : '', codigo));
  registrar_(ss, 'codigo_enviado', 'Pediu código para criar ou trocar a senha');
  return { ok: true };
}

// ======================================================================= cadastro aberto --

const CADASTROS_POR_DIA = 15;  // cada cadastro manda um código pela cineaned (cota dividida com os certificados)

/**
 * Qualquer pessoa cria a própria conta (pedido do Diego, 23/10/2026): entra como 'usuario', com marcações
 * pessoais. Depois segue o mesmo caminho do primeiro acesso: código por e-mail e senha.
 */
function cadastrar_(nome, email) {
  nome = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (nome.length < 3) throw falha_('Digite seu nome.');
  const ss = planilha_();
  USUARIO_ATUAL_ = email;
  if (email === CONTA_SISTEMA) throw falha_('Este e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".');
  const m = membro_(ss, email);
  if (m.p && m.p.senha) throw falha_('Este e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".');
  if (!m.p) {
    const lim = limitesDoDia_();
    if (lim.dados.cadastros >= CADASTROS_POR_DIA) throw falha_('O limite de cadastros de hoje foi atingido. Tente de novo amanhã.');
    lim.dados.cadastros++;
    lim.salvar();
    m.tab.sh.appendRow(linhaEquipe_({ email: email, nome: nome, admin: false, cadastrado_por: 'autocadastro',
                                      cadastrado_em: agora_(), perfil: 'usuario' }));
    registrar_(ss, 'autocadastro', email + ' · ' + nome);
  }
  // Já cadastrado sem senha (não terminou da outra vez): só manda um código novo.
  return pedirCodigo_(email);
}

/** Confere o código, grava a senha nova e já abre a sessão. */
function definirSenha_(email, codigo, senha) {
  senha = validarSenhaNova_(senha, email);
  const cache = CacheService.getScriptCache(), chave = 'codigo:' + email;
  const lim = limitesDoDia_(), meu = lim.doEmail(email);
  if (meu.f >= ERROS_POR_EMAIL_DIA) throw falha_('Muitas tentativas erradas hoje para este e-mail. Tente de novo amanhã.');
  const salvo = JSON.parse(cache.get(chave) || 'null');
  if (!salvo) throw falha_('Código expirado ou não pedido. Peça um novo código.');
  if (salvo.h !== hmac_(email + '|' + codigo)) {
    meu.f++; lim.salvar();
    salvo.erros++;
    if (salvo.erros >= CODIGO_TENTATIVAS) { cache.remove(chave); throw falha_('Código errado muitas vezes. Peça um novo código.'); }
    cache.put(chave, JSON.stringify(salvo), CODIGO_MINUTOS * 60);
    const resta = CODIGO_TENTATIVAS - salvo.erros;
    throw falha_('Código incorreto. ' + (resta === 1 ? 'Resta 1 tentativa.' : 'Restam ' + resta + ' tentativas.'));
  }
  cache.remove(chave);
  const ss = planilha_();
  USUARIO_ATUAL_ = email;
  if (!podeEntrar_(ss, email)) throw falha_('Este e-mail não está mais cadastrado no Boletim.');
  const tinha = !!(senhaDe_(ss, email) || {}).senha;
  const hash = gravarSenha_(ss, email, hashSenha_(senha));
  cache.remove('senha-erros:' + email);
  registrar_(ss, tinha ? 'senha_redefinida' : 'senha_criada', tinha ? 'Trocou a senha com código por e-mail' : 'Criou a senha no primeiro acesso');
  return abrirSessao_(ss, email, hash);
}

// ======================================================================= entrada --

function entrar_(email, senha) {
  const cache = CacheService.getScriptCache(), kErros = 'senha-erros:' + email;
  const erros = parseInt(cache.get(kErros), 10) || 0;
  if (erros >= SENHA_ERROS_BLOQUEIO)
    throw falha_('Senha errada muitas vezes. Aguarde ' + SENHA_BLOQUEIO_MIN + ' minutos ou use "Esqueci a senha".');
  const lim = limitesDoDia_(), meu = lim.doEmail(email);
  if (meu.f >= ERROS_POR_EMAIL_DIA) throw falha_('Muitas tentativas erradas hoje para este e-mail. Tente de novo amanhã ou use "Esqueci a senha".');
  const ss = planilha_();
  USUARIO_ATUAL_ = email;
  const s = podeEntrar_(ss, email) ? senhaDe_(ss, email) : null;
  if (s && !s.senha) throw falha_('Você ainda não criou sua senha. Clique em "Primeiro acesso" para receber um código por e-mail.');
  if (!s || !senhaConfere_(String(senha || ''), s.senha)) {
    // Mesma mensagem para e-mail desconhecido e senha errada.
    cache.put(kErros, String(erros + 1), SENHA_BLOQUEIO_MIN * 60);
    meu.f++;
    if (!s && lim.dados.recusas++ < RECUSAS_REGISTRADAS_DIA) registrar_(ss, 'entrada_recusada', 'E-mail fora da equipe');
    else if (s) registrar_(ss, 'senha_errada', 'Tentativa ' + (erros + 1) + ' seguida');
    lim.salvar();
    throw falha_('E-mail ou senha incorretos.');
  }
  cache.remove(kErros);
  registrar_(ss, 'entrada', 'Entrou com e-mail e senha');
  return abrirSessao_(ss, email, s.senha);
}

// ======================================================================= sessão --

function abrirSessao_(ss, email, hashSenha) {
  const props = PropertiesService.getScriptProperties();
  limparSessoes_(props);
  const sessao = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('sessao:' + hmac_(sessao), JSON.stringify({ email: email, v: versaoSenha_(hashSenha), expira: Date.now() + SESSAO_DIAS * DIA_MS }));
  return { sessao: sessao, perfil: perfil_(ss, email) };
}

function limparSessoes_(props) {
  const agora = Date.now(), todas = props.getProperties();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('sessao:') !== 0) return;
    let s = null;
    try { s = JSON.parse(todas[k]); } catch (e) { /* valor estranho: apaga */ }
    if (!s || !(s.expira > agora)) props.deleteProperty(k);
  });
}

/**
 * Confere a sessão e devolve o e-mail. Cai na hora se a pessoa saiu da equipe ou se a senha foi trocada
 * (em outro navegador ou pelo administrador). O uso diário renova o prazo.
 */
function validarSessao_(ss, sessao) {
  if (!sessao) throw falha_(SESSAO_INVALIDA);
  const props = PropertiesService.getScriptProperties(), chave = 'sessao:' + hmac_(sessao);
  let s = null;
  try { s = JSON.parse(props.getProperty(chave) || 'null'); } catch (e) { /* idem */ }
  const agora = Date.now();
  const atual = s && podeEntrar_(ss, s.email) ? senhaDe_(ss, s.email) : null;
  if (!s || !(s.expira > agora) || !atual || !atual.senha || versaoSenha_(atual.senha) !== s.v) {
    if (s) props.deleteProperty(chave);
    throw falha_(SESSAO_INVALIDA);
  }
  if (s.expira - agora < (SESSAO_DIAS - 1) * DIA_MS) {
    s.expira = agora + SESSAO_DIAS * DIA_MS;
    props.setProperty(chave, JSON.stringify(s));
  }
  return s.email;
}

/** Acesso: no máximo um registro (e uma gravação de "último acesso") a cada 30 minutos por pessoa. */
function registrarAcesso_(ss) {
  try {
    const cache = CacheService.getScriptCache(), chave = 'acesso:' + USUARIO_ATUAL_;
    if (cache.get(chave)) return;
    cache.put(chave, '1', 30 * 60);
    registrar_(ss, 'acesso', 'Abriu o Boletim');
    const m = membro_(ss, USUARIO_ATUAL_);
    // Visita nova (mais de 30 min sem usar): o último acesso vira a "visita anterior", base do "novos desde a sua última visita".
    if (m.p) {
      m.p.visita_anterior = m.p.ultimo_acesso; m.p.ultimo_acesso = agora_();
      salvarCampos_(m.tab, m.p, ['visita_anterior', 'ultimo_acesso']);
    }
  } catch (e) { /* auxiliar */ }
}

// ==================================================================== ações com sessão --

function perfil_(ss, email) {
  const m = membro_(ss, email).p;
  return { email: email, nome: m ? m.nome : 'Conta do sistema', admin: ehAdmin_(ss, email), sistema: email === CONTA_SISTEMA,
           tipo: tipoDe_(ss, email),
           cadastrado_em: m ? m.cadastrado_em : '', cadastrado_por: m ? m.cadastrado_por : '',
           senha_em: m ? m.senha_em : prop_('SENHA_SISTEMA_EM') || '', ultimo_acesso: m ? m.ultimo_acesso : '',
           visita_anterior: m ? m.visita_anterior : '', avisos: avisosDe_(m) };
}

function exigirAdmin_(ss) {
  if (!ehAdmin_(ss, USUARIO_ATUAL_)) throw falha_('Só administradores podem fazer isso.');
}

function api_perfil_(ss) { registrarAcesso_(ss); return perfil_(ss, USUARIO_ATUAL_); }

function api_alterarSenha_(ss, atual, nova) {
  const s = senhaDe_(ss, USUARIO_ATUAL_);
  if (!senhaConfere_(String(atual || ''), s.senha)) throw falha_('A senha atual não confere.');
  nova = validarSenhaNova_(nova, USUARIO_ATUAL_);
  if (atual === nova) throw falha_('A senha nova precisa ser diferente da atual.');
  const hash = gravarSenha_(ss, USUARIO_ATUAL_, hashSenha_(nova));
  registrar_(ss, 'senha_alterada', 'Trocou a própria senha');
  // As outras sessões caem (a versão da senha mudou); esta continua com uma sessão nova.
  return abrirSessao_(ss, USUARIO_ATUAL_, hash);
}

function api_equipe_(ss) {
  exigirAdmin_(ss);
  return lerAba_(ss, 'Equipe').linhas.map(function (p) {
    return { email: p.email, nome: p.nome, admin: verdadeiro_(p.admin), cadastrado_por: p.cadastrado_por,
             cadastrado_em: p.cadastrado_em, boasvindas_em: p.boasvindas_em, tem_senha: !!p.senha,
             senha_em: p.senha_em, ultimo_acesso: p.ultimo_acesso, perfil: p.perfil === 'usuario' ? 'usuario' : 'equipe',
             avisos: avisosDe_(p) };
  }).sort(function (a, b) {  // equipe do CINEA primeiro, depois quem se cadastrou sozinho
    return (a.perfil === b.perfil ? 0 : a.perfil === 'equipe' ? -1 : 1) || a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

function api_salvarMembro_(ss, email, nome, admin, boasVindas, perfil) {
  exigirAdmin_(ss);
  email = emailLimpo_(email);
  nome = String(nome || '').trim().slice(0, 120);
  if (!nome) throw falha_('Digite o nome da pessoa.');
  if (email === CONTA_SISTEMA) throw falha_('A conta do sistema já é administradora e não entra na lista.');
  const m = membro_(ss, email);
  if (m.p) {
    if (m.p.email === USUARIO_ATUAL_ && verdadeiro_(m.p.admin) && !admin && ultimoAdmin_(m.tab)) throw falha_('Você é o único administrador: cadastre outro antes de tirar o seu.');
    const rotulo = function (p) { return p.nome + (verdadeiro_(p.admin) ? ' (admin)' : '') + (p.perfil === 'usuario' ? ' (usuário)' : ''); };
    const antes = rotulo(m.p);
    m.p.nome = nome; m.p.admin = !!admin;
    if (perfil === 'usuario' || perfil === 'equipe') m.p.perfil = perfil === 'usuario' ? 'usuario' : '';
    if (m.p.perfil === 'usuario') m.p.admin = false;  // administrador é sempre da equipe
    salvarCampos_(m.tab, m.p, ['nome', 'admin', 'perfil']);
    registrar_(ss, 'membro_alterado', email + ': ' + antes + ' → ' + rotulo(m.p));
  } else {
    m.tab.sh.appendRow(linhaEquipe_({ email: email, nome: nome, admin: !!admin, cadastrado_por: USUARIO_ATUAL_, cadastrado_em: agora_() }));
    registrar_(ss, 'membro_cadastrado', email + ' · ' + nome + (admin ? ' (admin)' : ''));
    if (boasVindas) api_enviarBoasVindas_(ss, email);
  }
  return api_equipe_(ss);
}

function ultimoAdmin_(tab) {
  return tab.linhas.filter(function (p) { return verdadeiro_(p.admin); }).length <= 1;
}

function api_removerMembro_(ss, email) {
  exigirAdmin_(ss);
  email = emailLimpo_(email);
  if (email === USUARIO_ATUAL_) throw falha_('Você não pode remover a si mesmo.');
  const m = membro_(ss, email);
  if (!m.p) throw falha_('Pessoa não encontrada.');
  m.tab.sh.deleteRow(m.p._linha);
  registrar_(ss, 'membro_removido', email + ' · ' + m.p.nome);
  return api_equipe_(ss);  // a sessão dela cai sozinha na próxima chamada (validarSessao_)
}

/** Apaga a senha: a pessoa precisa fazer o primeiro acesso de novo. Todas as sessões dela caem. */
function api_apagarSenha_(ss, email) {
  exigirAdmin_(ss);
  email = emailLimpo_(email);
  const m = membro_(ss, email);
  if (!m.p) throw falha_('Pessoa não encontrada.');
  m.p.senha = ''; m.p.senha_em = '';
  salvarCampos_(m.tab, m.p, ['senha', 'senha_em']);
  registrar_(ss, 'senha_apagada', 'Apagou a senha de ' + email);
  return api_equipe_(ss);
}

function api_enviarBoasVindas_(ss, email) {
  exigirAdmin_(ss);
  email = emailLimpo_(email);
  const m = membro_(ss, email);
  if (!m.p) throw falha_('Pessoa não encontrada.');
  if (MailApp.getRemainingDailyQuota() <= RESERVA_CERTIFICADOS) throw falha_('O limite de e-mails de hoje foi atingido. Tente amanhã.');
  const quem = perfil_(ss, USUARIO_ATUAL_).nome;
  enviarEmail_(email, emailBoasVindas_(m.p.nome, quem, email));
  m.p.boasvindas_em = agora_();
  salvarCampos_(m.tab, m.p, ['boasvindas_em']);
  registrar_(ss, 'boasvindas_enviado', email);
  return api_equipe_(ss);
}

function api_registro_(ss) {
  exigirAdmin_(ss);
  const linhas = lerAba_(ss, 'Registro').linhas;
  return linhas.slice(-300).reverse().map(function (r) { return { quando: r.quando, quem: r.quem, acao: r.acao, detalhe: r.detalhe }; });
}

/** Ações que o navegador pode pedir com uma sessão válida (o resto não existe para ele). */
/** Meu perfil: a pessoa troca só o próprio nome (e-mail e perfil, só um administrador muda). */
function api_salvarMeuNome_(ss, nome) {
  nome = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!nome) throw falha_('Digite o seu nome.');
  const m = membro_(ss, USUARIO_ATUAL_);
  if (!m.p) throw falha_('A conta do sistema não tem nome para trocar.');
  const antes = m.p.nome;
  m.p.nome = nome;
  salvarCampos_(m.tab, m.p, ['nome']);
  registrar_(ss, 'nome_alterado', antes + ' → ' + nome);
  return perfil_(ss, USUARIO_ATUAL_);
}

// ===================================================================== marcações das notícias --

const TIPOS_MARCA = ['sinalizada', 'irrelevante'];
const ROTULO_MARCA = { sinalizada: 'Sinalizou', irrelevante: 'Marcou como sem relevância' };
const ID_ITEM_RE = /^[a-f0-9]{16}$/;   // id gerado pelo coletor (radar/fontes.py: gerar_id)

function mapaNomes_(ss) {
  const m = {};
  lerAba_(ss, 'Equipe').linhas.forEach(function (p) { m[p.email.toLowerCase()] = p.nome; });
  m[CONTA_SISTEMA] = 'Conta do sistema';
  return m;
}

/**
 * Tudo o que a equipe marcou: sinalizadas, sem relevância e lidas. As três são compartilhadas
 * (pedido do Diego em 23/10/2026): o que uma pessoa marca aparece para todos, com o nome de quem marcou.
 */
function api_marcacoes_(ss) {
  if (tipoDe_(ss, USUARIO_ATUAL_) === 'usuario') return marcacoesPessoais_(ss);
  const nomes = mapaNomes_(ss);
  const marcas = lerAba_(ss, 'Marcacoes').linhas.map(function (r) {
    return { id: r.item_id, tipo: r.tipo, por: r.por, nome: nomes[r.por] || r.por, em: r.em, motivo: r.motivo };
  });
  const vistos = {}, lidos = [];
  lerAba_(ss, 'Lidos').linhas.forEach(function (r) {  // planilhas antigas podem ter uma linha por pessoa: vale a primeira
    if (vistos[r.item_id]) return;
    vistos[r.item_id] = true;
    lidos.push({ id: r.item_id, por: r.email, nome: nomes[r.email] || r.email, em: r.em });
  });
  return { marcas: marcas, lidos: lidos };
}

/**
 * Liga ou desliga uma marcação. Sinalizada e sem relevância não convivem: marcar uma tira a outra.
 * Devolve as marcações atualizadas da equipe.
 */
function api_marcar_(ss, id, tipo, ativo, motivo, titulo, link) {
  id = String(id || '');
  if (!ID_ITEM_RE.test(id)) throw falha_('Notícia inválida.');
  if (TIPOS_MARCA.indexOf(tipo) < 0) throw falha_('Marcação inválida.');
  if (tipoDe_(ss, USUARIO_ATUAL_) === 'usuario') {
    if (tipo !== 'sinalizada') throw falha_('Só a equipe do CINEA marca notícias como sem relevância.');
    marcarPessoal_(ss, [id], 'sinalizada', ativo);
    return marcacoesPessoais_(ss).marcas;
  }
  motivo = String(motivo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  titulo = String(titulo || '').slice(0, 300);
  link = /^https:\/\//.test(String(link || '')) ? String(link).slice(0, 600) : '';
  return comTrava_(function () {
    const tab = lerAba_(ss, 'Marcacoes');
    // Apaga de baixo para cima, para os números das linhas não mudarem no meio.
    tab.linhas.filter(function (r) { return r.item_id === id && (r.tipo === tipo || ativo); })
      .sort(function (a, b) { return b._linha - a._linha; })
      .forEach(function (r) { tab.sh.deleteRow(r._linha); });
    if (ativo) tab.sh.appendRow(linha_([id, tipo, USUARIO_ATUAL_, agora_(), motivo, titulo, link]));
    CacheService.getScriptCache().remove('publico');  // visitantes passam a ver a mudança na hora
    registrar_(ss, ativo ? 'item_' + tipo : 'item_' + tipo + '_desfeito', titulo + (motivo ? ' · ' + motivo : ''));
    return api_marcacoes_(ss).marcas;
  });
}

/**
 * Marca notícias como lidas (ou não lidas) PARA A EQUIPE. Lida: guarda quem leu primeiro (se já foi lida,
 * nada muda). Não lida: tira a marcação para todos e entra no registro, porque afeta a equipe inteira.
 */
function api_marcarLidos_(ss, ids, lido) {
  ids = (Array.isArray(ids) ? ids : []).map(String).filter(function (i) { return ID_ITEM_RE.test(i); }).slice(0, 1000);
  if (!ids.length) return true;
  if (tipoDe_(ss, USUARIO_ATUAL_) === 'usuario') { marcarPessoal_(ss, ids, 'lida', lido); return true; }
  return comTrava_(function () {
    const tab = lerAba_(ss, 'Lidos'), jaLidos = {};
    tab.linhas.forEach(function (r) { (jaLidos[r.item_id] = jaLidos[r.item_id] || []).push(r); });
    if (lido) {
      const novas = ids.filter(function (i, k) { return !jaLidos[i] && ids.indexOf(i) === k; })
        .map(function (i) { return [USUARIO_ATUAL_, i, agora_()]; });
      if (novas.length) tab.sh.getRange(tab.sh.getLastRow() + 1, 1, novas.length, 3).setValues(novas);
    } else {
      const apagar = [];
      ids.forEach(function (i) { (jaLidos[i] || []).forEach(function (r) { apagar.push(r); }); });
      apagar.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (r) { tab.sh.deleteRow(r._linha); });
      if (apagar.length) registrar_(ss, 'item_nao_lida', ids.length + ' notícia(s) voltaram a "não lida" para a equipe');
    }
    return true;
  });
}

// ======================================================================= painel aberto e uso --

/**
 * O que um visitante sem login precisa: só os ids marcados como sem relevância (para o Início esconder
 * o mesmo que a equipe esconde). Sem nomes de quem marcou. Guardado 60 s no cache.
 */
function publico_() {
  const cache = CacheService.getScriptCache(), guardado = cache.get('publico');
  if (guardado) return JSON.parse(guardado);
  const irrelevantes = lerAba_(planilha_(), 'Marcacoes').linhas
    .filter(function (r) { return r.tipo === 'irrelevante'; }).map(function (r) { return r.item_id; });
  const r = { irrelevantes: irrelevantes };
  cache.put('publico', JSON.stringify(r), 60);
  return r;
}

const TIPOS_EVENTO = ['abertura', 'visao', 'noticia', 'busca', 'csv'];
const VISITANTE_RE = /^[a-z0-9]{10,40}$/;
const EVENTOS_POR_VISITANTE_HORA = 200;
const EVENTOS_POR_MINUTO = 300;

/** Registra um evento de uso do painel. Nunca falha para quem está usando: no pior caso, não registra. */
function evento_(p) {
  const visitante = String(p.visitante || '');
  const tipo = String(p.tipo || '');
  if (!VISITANTE_RE.test(visitante) || TIPOS_EVENTO.indexOf(tipo) < 0) return false;
  const cache = CacheService.getScriptCache();
  const kV = 'ev:' + visitante, nV = parseInt(cache.get(kV), 10) || 0;
  const kM = 'ev-min:' + Math.floor(Date.now() / 60000), nM = parseInt(cache.get(kM), 10) || 0;
  if (nV >= EVENTOS_POR_VISITANTE_HORA || nM >= EVENTOS_POR_MINUTO) return false;
  cache.put(kV, String(nV + 1), 60 * 60);
  cache.put(kM, String(nM + 1), 120);
  const ss = planilha_();
  let email = '';
  if (p.sessao) { try { email = validarSessao_(ss, String(p.sessao)); } catch (e) { /* sessão vencida: conta como visitante */ } }
  const detalhe = String(p.detalhe || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const dispositivo = p.dispositivo === 'celular' ? 'celular' : 'computador';
  lerAba_(ss, 'Acessos').sh.appendRow(linha_([agora_(), visitante, email, tipo, detalhe, dispositivo]));
  return true;
}

/**
 * Relatório de uso para os administradores (página Administrador): visitas por dia e por hora da semana,
 * equipe x público, quem da equipe usa, o que é mais aberto e buscado. Agregado aqui, para não mandar linhas cruas.
 */
function api_uso_(ss, dias) {
  exigirAdmin_(ss);
  dias = [7, 30, 90, 180, 365].indexOf(Number(dias)) >= 0 ? Number(dias) : 30;
  const inicio = Utilities.formatDate(new Date(Date.now() - (dias - 1) * DIA_MS), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const nomes = mapaNomes_(ss), tipos = {};
  const pessoas = lerAba_(ss, 'Equipe').linhas;
  pessoas.forEach(function (p) { tipos[p.email.toLowerCase()] = p.perfil === 'usuario' ? 'usuario' : 'equipe'; });
  const cadastrosNovos = pessoas.filter(function (p) { return p.perfil === 'usuario' && p.cadastrado_em.slice(0, 10) >= inicio; }).length;
  const linhas = lerAba_(ss, 'Acessos').linhas.filter(function (r) { return r.quando.slice(0, 10) >= inicio; });

  const calor = [0, 1, 2, 3, 4, 5, 6].map(function () { return Array(24).fill(0); });  // [dia da semana][hora], 0 = domingo
  const porDia = {}, visitantes = {}, visitantesEquipe = {}, equipe = {}, visoes = {}, instituicoes = {}, noticias = {}, buscas = {};
  const disp = { computador: 0, celular: 0 };
  let aberturas = 0, aberturasEquipe = 0, aberturasUsuarios = 0, csv = 0, noticiasAbertas = 0;
  const pessoasUsuarios = {};
  const conta = function (obj, chave, extra) { obj[chave] = obj[chave] || Object.assign({ n: 0 }, extra || {}); obj[chave].n++; return obj[chave]; };

  linhas.forEach(function (r) {
    const dia = r.quando.slice(0, 10), hora = parseInt(r.quando.slice(11, 13), 10);
    if (r.tipo === 'abertura') {
      aberturas++;
      const d = new Date(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
      calor[d.getDay()][hora]++;
      porDia[dia] = porDia[dia] || { equipe: 0, usuarios: 0, publico: 0 };
      visitantes[r.visitante] = true;
      disp[r.dispositivo === 'celular' ? 'celular' : 'computador']++;
      if (r.email) {
        visitantesEquipe[r.visitante] = true;
        const ehUsuario = tipos[r.email] === 'usuario';
        if (ehUsuario) { aberturasUsuarios++; porDia[dia].usuarios++; pessoasUsuarios[r.email] = true; }
        else { aberturasEquipe++; porDia[dia].equipe++; }
        const e = conta(equipe, r.email, { nome: nomes[r.email] || r.email, ultimo: '', perfil: ehUsuario ? 'usuario' : 'equipe' });
        if (r.quando > e.ultimo) e.ultimo = r.quando;
      } else porDia[dia].publico++;
    } else if (r.tipo === 'visao') conta(visoes, r.detalhe || 'inicio');
    else if (r.tipo === 'noticia') {
      noticiasAbertas++;
      const partes = r.detalhe.split('|');  // instituição|prioridade|título
      conta(instituicoes, partes[0] || '?');
      conta(noticias, partes.slice(2).join('|') || '?', { instituicao: partes[0] || '' });
    } else if (r.tipo === 'busca' && r.detalhe) conta(buscas, r.detalhe.toLowerCase());
    else if (r.tipo === 'csv') csv++;
  });

  const top = function (obj, n) {
    return Object.keys(obj).map(function (k) { return Object.assign({ chave: k }, obj[k]); })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, n);
  };
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = Utilities.formatDate(new Date(Date.now() - i * DIA_MS), 'America/Sao_Paulo', 'yyyy-MM-dd');
    serie.push({ dia: d, equipe: (porDia[d] || {}).equipe || 0, usuarios: (porDia[d] || {}).usuarios || 0, publico: (porDia[d] || {}).publico || 0 });
  }
  return {
    dias: dias, aberturas: aberturas, aberturas_equipe: aberturasEquipe, aberturas_usuarios: aberturasUsuarios,
    aberturas_publico: aberturas - aberturasEquipe - aberturasUsuarios,
    pessoas_usuarios: Object.keys(pessoasUsuarios).length, cadastros_novos: cadastrosNovos,
    total_usuarios: pessoas.filter(function (p) { return p.perfil === 'usuario'; }).length,
    visitantes: Object.keys(visitantes).length, visitantes_publico: Object.keys(visitantes).length - Object.keys(visitantesEquipe).length,
    pessoas_equipe: Object.keys(equipe).length - Object.keys(pessoasUsuarios).length, noticias_abertas: noticiasAbertas, csv: csv, dispositivos: disp,
    calor: calor, serie: serie, equipe: top(equipe, 50), visoes: top(visoes, 10), instituicoes: top(instituicoes, 10),
    noticias: top(noticias, 10), buscas: top(buscas, 10)
  };
}

/**
 * Marcações de quem tem perfil Usuário: as sinalizadas e lidas DELA, mais as "sem relevância" da equipe
 * (só os ids, para o Início esconder o mesmo que para todos).
 */
function marcacoesPessoais_(ss) {
  const meu = lerAba_(ss, 'Pessoais').linhas.filter(function (r) { return r.email === USUARIO_ATUAL_; });
  const nome = (membro_(ss, USUARIO_ATUAL_).p || {}).nome || USUARIO_ATUAL_;
  const marcas = meu.filter(function (r) { return r.tipo === 'sinalizada'; })
    .map(function (r) { return { id: r.item_id, tipo: 'sinalizada', por: r.email, nome: nome, em: r.em, pessoal: true }; })
    .concat(publico_().irrelevantes.map(function (id) { return { id: id, tipo: 'irrelevante' }; }));
  const lidos = meu.filter(function (r) { return r.tipo === 'lida'; })
    .map(function (r) { return { id: r.item_id, por: r.email, nome: nome, em: r.em }; });
  return { marcas: marcas, lidos: lidos, pessoal: true };
}

function marcarPessoal_(ss, ids, tipo, ativo) {
  return comTrava_(function () {
    const tab = lerAba_(ss, 'Pessoais'), meus = {};
    tab.linhas.forEach(function (r) { if (r.email === USUARIO_ATUAL_ && r.tipo === tipo) meus[r.item_id] = r; });
    if (ativo) {
      const novas = ids.filter(function (i, k) { return !meus[i] && ids.indexOf(i) === k; })
        .map(function (i) { return [USUARIO_ATUAL_, i, tipo, agora_()]; });
      if (novas.length) tab.sh.getRange(tab.sh.getLastRow() + 1, 1, novas.length, 4).setValues(novas);
    } else {
      ids.map(function (i) { return meus[i]; }).filter(Boolean)
        .sort(function (a, b) { return b._linha - a._linha; })
        .forEach(function (r) { tab.sh.deleteRow(r._linha); });
    }
  });
}

// ======================================================================= avisos por e-mail --
//
// Cada pessoa com conta escolhe em "Meu perfil" o que quer receber (pedido do Diego, 26/10/2026):
//   imediato = logo depois de cada coleta, só as notícias novas;  semanal = resumo da semana, só se houver novidade.
// Em cada um, as prioridades: urgente, alta ou as duas. O coletor publica dados/avisos.json (só urgente e alta)
// e dois gatilhos deste script (criados por configurar) leem esse arquivo: verificarAvisos e resumoSemanal.
// Quem não conseguiu receber por causa da cota de e-mail fica numa fila e recebe na próxima conferência.

const PRIORIDADES_AVISO = ['urgente', 'alta'];
const ENDERECO_AVISOS = ENDERECO_PAINEL + 'dados/avisos.json';
const AVISOS_MINUTOS = 15;        // de quanto em quanto tempo o servidor confere se houve coleta nova
const RESUMO_DIA = 'MONDAY';      // resumo semanal: segunda-feira...
const RESUMO_HORA = 8;            // ...às 8h (Brasília)
const FILA_MAX = 300;             // e-mails esperando cota, no máximo
const TESTES_AVISO_DIA = 3;       // "Enviar um exemplo para mim", por pessoa
const ROTULO_PRIORIDADE = { urgente: 'Urgente', alta: 'Prioridade alta' };

function listaAvisos_(v) {
  const l = Array.isArray(v) ? v.map(String) : String(v || '').split(',').map(function (x) { return x.trim(); });
  return PRIORIDADES_AVISO.filter(function (p) { return l.indexOf(p) >= 0; });
}
function avisosDe_(p) {
  return { imediato: listaAvisos_(p && p.avisos_imediato), semanal: listaAvisos_(p && p.avisos_semanal) };
}
function descreverAvisos_(a) {
  const d = function (l) { return l.length ? l.map(function (p) { return ROTULO_PRIORIDADE[p].toLowerCase(); }).join(' e ') : 'nada'; };
  return 'imediato: ' + d(a.imediato) + ' · semanal: ' + d(a.semanal);
}
/** Identificador do link "parar de receber": não mostra o e-mail e só o servidor sabe gerar. */
function chaveAvisos_(email) { return hmac_('avisos|' + email).slice(0, 32); }
/** Mesmo formato do coletor (visto_em): "2026-10-26T07:00:00+00:00", para comparar como texto. */
function isoUtc_(ms) { return new Date(ms).toISOString().slice(0, 19) + '+00:00'; }

function api_salvarAvisos_(ss, imediato, semanal) {
  const m = membro_(ss, USUARIO_ATUAL_);
  if (!m.p) throw falha_('A conta do sistema não recebe avisos. Entre com o seu e-mail para escolher.');
  const novo = { imediato: listaAvisos_(imediato), semanal: listaAvisos_(semanal) };
  const antes = descreverAvisos_(avisosDe_(m.p));
  m.p.avisos_imediato = novo.imediato.join(','); m.p.avisos_semanal = novo.semanal.join(',');
  salvarCampos_(m.tab, m.p, ['avisos_imediato', 'avisos_semanal']);
  registrar_(ss, 'avisos_alterados', antes + ' → ' + descreverAvisos_(novo));
  return perfil_(ss, USUARIO_ATUAL_);
}

/** "Enviar um exemplo para mim": as últimas notícias que a pessoa receberia, marcadas como exemplo. */
function api_testarAvisos_(ss) {
  const m = membro_(ss, USUARIO_ATUAL_);
  if (!m.p) throw falha_('A conta do sistema não recebe avisos.');
  const a = avisosDe_(m.p), prioridades = listaAvisos_(a.imediato.concat(a.semanal));
  if (!prioridades.length) throw falha_('Escolha pelo menos um aviso e salve antes de pedir o exemplo.');
  const cache = CacheService.getScriptCache(), chave = 'teste-aviso:' + USUARIO_ATUAL_;
  const n = parseInt(cache.get(chave), 10) || 0;
  if (n >= TESTES_AVISO_DIA) throw falha_('Você já pediu ' + TESTES_AVISO_DIA + ' exemplos hoje. Tente amanhã.');
  if (MailApp.getRemainingDailyQuota() <= RESERVA_CERTIFICADOS) throw falha_('O limite de e-mails de hoje do sistema foi atingido. Tente amanhã.');
  const irr = irrelevantes_();
  const itens = lerAvisos_().itens.filter(function (it) { return prioridades.indexOf(it.prioridade) >= 0 && !irr[it.id]; })
    .sort(function (x, y) { return y.visto_em < x.visto_em ? -1 : 1; }).slice(0, 3);
  if (!itens.length) throw falha_('Não há notícias recentes com essas prioridades para montar o exemplo.');
  cache.put(chave, String(n + 1), 24 * 60 * 60);
  enviarAviso_(m.p, a.imediato.length ? 'imediato' : 'semanal', itens, true);
  registrar_(ss, 'aviso_exemplo', 'Pediu um exemplo do aviso por e-mail');
  return { para: USUARIO_ATUAL_, itens: itens.length };
}

/** Link "parar de receber" do rodapé dos avisos: abre o painel, que confirma e chama esta ação (sem login). */
function cancelarAvisos_(chave) {
  chave = String(chave || '');
  if (!/^[A-Za-z0-9_-]{32}$/.test(chave)) throw falha_('Link inválido. Para mudar os avisos, entre e abra "Meu perfil".');
  const ss = planilha_(), tab = lerAba_(ss, 'Equipe');
  const p = tab.linhas.filter(function (x) { return chaveAvisos_(x.email.toLowerCase()) === chave; })[0];
  if (!p) throw falha_('Link inválido ou de uma conta que não existe mais.');
  USUARIO_ATUAL_ = p.email.toLowerCase();
  const tinha = avisosDe_(p);
  p.avisos_imediato = ''; p.avisos_semanal = '';
  salvarCampos_(tab, p, ['avisos_imediato', 'avisos_semanal']);
  registrar_(ss, 'avisos_cancelados', 'Parou de receber pelo link do e-mail (tinha ' + descreverAvisos_(tinha) + ')');
  return { nome: p.nome };
}

function lerAvisos_() {
  const r = UrlFetchApp.fetch(ENDERECO_AVISOS + '?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('avisos.json respondeu ' + r.getResponseCode());
  const d = JSON.parse(r.getContentText());
  return { gerado_em: String(d.gerado_em || ''), itens: Array.isArray(d.itens) ? d.itens : [] };
}
function irrelevantes_() {
  const m = {};
  publico_().irrelevantes.forEach(function (id) { m[id] = true; });
  return m;
}
/** Pessoas com senha criada que escolheram algo neste tipo de aviso. */
function assinantes_(ss, tipo) {
  return lerAba_(ss, 'Equipe').linhas.filter(function (p) { return p.senha && avisosDe_(p)[tipo].length; });
}

/** Gatilho a cada 15 min: se houve coleta nova, avisa na hora quem pediu. */
function verificarAvisos() {
  USUARIO_ATUAL_ = 'avisos automáticos';
  try {
    comTrava_(function () {
      const props = PropertiesService.getScriptProperties(), ss = planilha_(), dados = lerAvisos_();
      const ultimo = prop_('AVISOS_ULTIMO');
      const maisNovo = dados.itens.reduce(function (m, it) { return it.visto_em > m ? it.visto_em : m; }, ultimo || '');
      if (!ultimo) {  // primeira conferência: só marca o ponto de partida (não manda o histórico)
        props.setProperty('AVISOS_ULTIMO', maisNovo || isoUtc_(Date.now()));
        return;
      }
      const irr = irrelevantes_();
      const novos = dados.itens.filter(function (it) { return it.visto_em > ultimo && !irr[it.id]; });
      if (novos.length) {
        const fila = filaAvisos_();
        assinantes_(ss, 'imediato').forEach(function (p) {
          const quer = avisosDe_(p).imediato;
          const ids = novos.filter(function (it) { return quer.indexOf(it.prioridade) >= 0; }).map(function (it) { return it.id; });
          if (ids.length) fila.push({ email: p.email.toLowerCase(), tipo: 'imediato', ids: ids });
        });
        gravarFila_(fila);
      }
      props.setProperty('AVISOS_ULTIMO', maisNovo);
      enviarFila_(ss, dados);
    });
  } catch (e) { console.error(e); }
}

/** Gatilho semanal (segunda, 8h): resumo dos últimos 7 dias, só para quem tem novidade. */
function resumoSemanal() {
  USUARIO_ATUAL_ = 'avisos automáticos';
  try {
    comTrava_(function () {
      const ss = planilha_(), dados = lerAvisos_(), desde = isoUtc_(Date.now() - 7 * DIA_MS), irr = irrelevantes_();
      const daSemana = dados.itens.filter(function (it) { return it.visto_em >= desde && !irr[it.id]; });
      const fila = filaAvisos_();
      assinantes_(ss, 'semanal').forEach(function (p) {
        const quer = avisosDe_(p).semanal;
        const ids = daSemana.filter(function (it) { return quer.indexOf(it.prioridade) >= 0; }).map(function (it) { return it.id; });
        if (ids.length) fila.push({ email: p.email.toLowerCase(), tipo: 'semanal', ids: ids, desde: desde });
      });
      gravarFila_(fila);
      enviarFila_(ss, dados);
    });
  } catch (e) { console.error(e); }
}

function filaAvisos_() {
  try { return JSON.parse(prop_('AVISOS_FILA') || '[]'); } catch (e) { return []; }
}
function gravarFila_(fila) {
  // Uma propriedade guarda até 9 KB: além do limite, saem os pedidos mais antigos.
  fila = fila.slice(-FILA_MAX);
  let t = JSON.stringify(fila);
  while (t.length > 8500 && fila.length) { fila.shift(); t = JSON.stringify(fila); }
  PropertiesService.getScriptProperties().setProperty('AVISOS_FILA', t);
}

/** Manda o que está na fila enquanto houver cota (a reserva dos certificados nunca é usada). */
function enviarFila_(ss, dados) {
  const fila = filaAvisos_();
  if (!fila.length) return;
  const porId = {}, pessoas = {};
  dados.itens.forEach(function (it) { porId[it.id] = it; });
  lerAba_(ss, 'Equipe').linhas.forEach(function (p) { pessoas[p.email.toLowerCase()] = p; });
  const restam = [];
  let enviados = 0, semCota = 0;
  fila.forEach(function (pedido) {
    const p = pessoas[pedido.email];
    if (!p || !p.senha) return;                          // saiu da equipe ou apagaram a senha
    const quer = avisosDe_(p)[pedido.tipo];               // pode ter mudado de ideia enquanto esperava
    const itens = pedido.ids.map(function (id) { return porId[id]; })
      .filter(function (it) { return it && quer.indexOf(it.prioridade) >= 0; });
    if (!itens.length) return;
    if (MailApp.getRemainingDailyQuota() <= RESERVA_CERTIFICADOS) { semCota++; restam.push(pedido); return; }
    try { enviarAviso_(p, pedido.tipo, itens, false, pedido.desde); enviados++; }
    catch (e) { console.error(e); if ((pedido.erros = (pedido.erros || 0) + 1) < 3) restam.push(pedido); }
  });
  gravarFila_(restam);
  if (enviados) registrar_(ss, 'avisos_enviados', enviados + ' e-mail(s) de aviso');
  if (semCota) registrar_(ss, 'avisos_adiados', semCota + ' aviso(s) esperando a cota de e-mail de amanhã');
}

/** Gatilhos dos avisos (configurar chama; rodar de novo não duplica). */
function instalarGatilhos_() {
  const existentes = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (existentes.indexOf('verificarAvisos') < 0)
    ScriptApp.newTrigger('verificarAvisos').timeBased().everyMinutes(AVISOS_MINUTOS).create();
  if (existentes.indexOf('resumoSemanal') < 0)
    ScriptApp.newTrigger('resumoSemanal').timeBased().onWeekDay(ScriptApp.WeekDay[RESUMO_DIA]).atHour(RESUMO_HORA).create();
}

// ======================================================================= e-mails (padrão visual) --
//
// Todos os e-mails do Boletim saem do mesmo molde (emailHtml_), com as cores do painel (docs/estilo.css, tema claro):
// cabeçalho com o nome e o CINEA, título, conteúdo, botão, observação e rodapé. HTML em tabelas e estilos na linha,
// que é o que Gmail e Outlook entendem. Cada e-mail também tem a versão em texto puro.
// Modelos (montados aqui, enviados por quem chama):
//   emailCodigo_      código de 6 dígitos: cadastro novo, primeiro acesso ou troca de senha
//   emailBoasVindas_  administrador liberou o acesso
//   emailAviso_       aviso na hora, resumo semanal e o exemplo pedido em Meu perfil
// Prévia de todos: node acesso/teste/previa-emails.js (gera acesso/teste/previa-emails.html).

const COR_EMAIL = {
  fundo: '#f5f6f8', superficie: '#ffffff', borda: '#dfe3ea', texto: '#1b2230', suave: '#5b6578',
  marca: '#1f4e8c', marcaFundo: '#e8eff9', urgente: '#b42318', urgenteFundo: '#fdecea', alta: '#b54708', altaFundo: '#fef3e2'
};
const FONTE_EMAIL = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const ASSINATURA_EMAIL = 'Centro de Inovação em Ensino e Aprendizagem (CINEA) - NED (PUC Minas)';

function esc_(t) {
  return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function dataBr_(d) { return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
function contagem_(itens) {
  const nU = itens.filter(function (it) { return it.prioridade === 'urgente'; }).length, nA = itens.length - nU;
  const partes = [];
  if (nU) partes.push(nU + (nU > 1 ? ' notícias urgentes' : ' notícia urgente'));
  if (nA) partes.push(nA + (nA > 1 ? ' notícias' : ' notícia') + ' de prioridade alta');
  return partes.join(' e ');
}

/** Parágrafo no padrão do corpo. */
function pEmail_(html, extra) {
  return '<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:' + COR_EMAIL.texto + ';' + (extra || '') + '">' + html + '</p>';
}
/** Selo de prioridade igual ao do painel (fundo claro, texto na cor da prioridade). */
function seloEmail_(prioridade) {
  const urg = prioridade === 'urgente';
  return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;' +
    'text-transform:uppercase;background:' + (urg ? COR_EMAIL.urgenteFundo : COR_EMAIL.altaFundo) + ';color:' + (urg ? COR_EMAIL.urgente : COR_EMAIL.alta) + '">' +
    (urg ? 'Urgente' : 'Alta') + '</span>';
}
/** Botão principal (tabela: o Outlook não respeita padding em links soltos). */
function botaoEmail_(texto, url) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr>' +
    '<td style="background:' + COR_EMAIL.marca + ';border-radius:8px">' +
    '<a href="' + esc_(url) + '" style="display:inline-block;padding:11px 22px;font-family:' + FONTE_EMAIL + ';font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">' +
    esc_(texto) + '</a></td></tr></table>';
}
/** Caixa de destaque (observações, aviso de exemplo). tom: 'info' (azul) ou 'atencao' (laranja). */
function notaEmail_(html, tom) {
  const at = tom === 'atencao';
  return '<div style="margin:0 0 16px;padding:11px 14px;border-radius:8px;font-size:13px;line-height:1.5;background:' +
    (at ? COR_EMAIL.altaFundo : COR_EMAIL.marcaFundo) + ';color:' + COR_EMAIL.texto + '">' + html + '</div>';
}
/** Lista numerada de passos. */
function passosEmail_(passos) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;width:100%">' +
    passos.map(function (t, i) {
      return '<tr><td style="width:30px;vertical-align:top;padding:0 0 10px">' +
        '<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;text-align:center;font-size:12px;font-weight:700;' +
        'background:' + COR_EMAIL.marcaFundo + ';color:' + COR_EMAIL.marca + '">' + (i + 1) + '</span></td>' +
        '<td style="vertical-align:top;padding:1px 0 10px;font-size:15px;line-height:1.5;color:' + COR_EMAIL.texto + '">' + t + '</td></tr>';
    }).join('') + '</table>';
}

/**
 * Molde de todos os e-mails. o = { previa, titulo, corpo (HTML), rodape (HTML, opcional) }.
 * previa = texto que o Gmail mostra ao lado do assunto, antes de abrir.
 */
function emailHtml_(o) {
  const c = COR_EMAIL;
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + esc_(o.titulo) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + c.fundo + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + esc_(o.previa || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + c.fundo + '"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:' + FONTE_EMAIL + '">' +
    // cabeçalho: como o topo do painel
    '<tr><td style="background:' + c.superficie + ';border:1px solid ' + c.borda + ';border-bottom:0;border-top:4px solid ' + c.marca + ';border-radius:12px 12px 0 0;padding:20px 28px 16px">' +
    '<a href="' + esc_(ENDERECO_PAINEL) + '" style="text-decoration:none"><span style="font-size:19px;font-weight:700;color:' + c.texto + '">' + esc_(NOME_SISTEMA) + '</span></a>' +
    '<div style="font-size:12px;color:' + c.suave + ';margin-top:2px">' + esc_(ASSINATURA_EMAIL) + '</div></td></tr>' +
    // conteúdo
    '<tr><td style="background:' + c.superficie + ';border:1px solid ' + c.borda + ';border-top:1px solid ' + c.borda + ';border-radius:0 0 12px 12px;padding:24px 28px 10px">' +
    '<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:' + c.texto + '">' + esc_(o.titulo) + '</h1>' +
    o.corpo + '</td></tr>' +
    // rodapé
    '<tr><td style="padding:16px 28px 8px;font-size:12px;line-height:1.55;color:' + c.suave + '">' +
    (o.rodape ? o.rodape + '<br><br>' : '') +
    esc_(NOME_SISTEMA) + ' · <a href="' + esc_(ENDERECO_PAINEL) + '" style="color:' + c.suave + '">' + esc_(ENDERECO_PAINEL.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</a><br>' +
    'Monitoramento de MEC, INEP, CNE, CAPES, SEMESP, ABMES, ABED, FAPEMIG, CEE-MG e Diário Oficial da União.<br>' +
    esc_(ASSINATURA_EMAIL) + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

/** Rodapé em texto puro, igual para todos. */
function rodapeTexto_() {
  return '\n\n--\n' + NOME_SISTEMA + ' · ' + ENDERECO_PAINEL + '\n' + ASSINATURA_EMAIL;
}

/** Envia um e-mail montado por um dos modelos ({ assunto, texto, html }). */
function enviarEmail_(para, e) {
  MailApp.sendEmail(para, e.assunto, e.texto, { name: REMETENTE, htmlBody: e.html });
}

// ------------------------------------------------------------------- modelo: código --

/**
 * Código de 6 dígitos. motivo: 'cadastro' (criou a conta agora), 'primeiro' (cadastrado pelo administrador, ainda
 * sem senha) ou 'senha' (já tem senha: "Esqueci a senha").
 */
function emailCodigo_(motivo, nome, codigo) {
  const t = {
    cadastro: { assunto: 'confirme seu cadastro', titulo: 'Confirme seu e-mail',
                intro: 'Recebemos o seu cadastro no ' + NOME_SISTEMA + '. Para confirmar que este e-mail é seu, digite o código abaixo na tela de cadastro e crie a sua senha.' },
    primeiro: { assunto: 'seu primeiro acesso', titulo: 'Crie a sua senha',
                intro: 'Use o código abaixo na tela de primeiro acesso do ' + NOME_SISTEMA + ' para criar a sua senha.' },
    senha:    { assunto: 'troca de senha', titulo: 'Troque a sua senha',
                intro: 'Recebemos um pedido para trocar a senha do ' + NOME_SISTEMA + '. Digite o código abaixo na tela "Esqueci a senha" e escolha uma senha nova.' }
  }[motivo] || null;
  const m = t || { assunto: 'código de acesso', titulo: 'Seu código de acesso', intro: 'Use o código abaixo no ' + NOME_SISTEMA + '.' };
  const ola = nome ? 'Olá, ' + nome.split(' ')[0] + '!' : 'Olá!';
  const seguranca = 'Não repasse este código a ninguém: a equipe do CINEA nunca pede o código por telefone, mensagem ou e-mail.' +
    (motivo === 'senha' ? ' Se você não pediu a troca, ignore este e-mail: sua senha continua a mesma.'
                        : ' Se você não pediu este código, ignore este e-mail.');
  const corpo =
    pEmail_(esc_(ola) + ' ' + esc_(m.intro)) +
    '<div style="margin:4px 0 18px;padding:16px;border-radius:10px;text-align:center;background:' + COR_EMAIL.marcaFundo + '">' +
    '<div style="font-size:12px;color:' + COR_EMAIL.suave + ';margin-bottom:4px">Seu código</div>' +
    '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:' + COR_EMAIL.marca + '">' + esc_(codigo) + '</div>' +
    '<div style="font-size:12px;color:' + COR_EMAIL.suave + ';margin-top:4px">Vale por ' + CODIGO_MINUTOS + ' minutos</div></div>' +
    pEmail_('Digite o código só no endereço oficial: <a href="' + esc_(ENDERECO_PAINEL) + '" style="color:' + COR_EMAIL.marca + '">' +
            esc_(ENDERECO_PAINEL.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</a>') +
    notaEmail_(esc_(seguranca), 'atencao');
  return {
    assunto: codigo + ' é o seu código do ' + NOME_SISTEMA,
    texto: ola + '\n\n' + m.intro + '\n\nSeu código: ' + codigo + '\nEle vale por ' + CODIGO_MINUTOS + ' minutos e só deve ser digitado em ' +
      ENDERECO_PAINEL + '\n\n' + seguranca + rodapeTexto_(),
    html: emailHtml_({ previa: 'Código ' + codigo + ', válido por ' + CODIGO_MINUTOS + ' minutos.', titulo: m.titulo, corpo: corpo,
                       rodape: 'Você recebeu este e-mail porque este endereço foi usado no ' + esc_(NOME_SISTEMA) + '.' })
  };
}

// --------------------------------------------------------------- modelo: boas-vindas --

function emailBoasVindas_(nome, quem, email) {
  const passos = [
    'Abra o Boletim pelo botão abaixo.',
    'Clique em <b>Entrar</b> e depois em <b>Primeiro acesso</b>, com este e-mail (' + esc_(email) + ').',
    'Você vai receber um código de 6 dígitos. Digite o código e crie a sua senha.'
  ];
  const corpo =
    pEmail_('Olá, ' + esc_(nome.split(' ')[0]) + '! ' + esc_(quem) + ' liberou o seu acesso ao ' + esc_(NOME_SISTEMA) +
            ', o painel do CINEA que reúne comunicados, notícias, editais e atos oficiais da educação superior, já com a triagem do que é urgente.') +
    pEmail_('<b>Para entrar pela primeira vez:</b>', 'margin-bottom:10px') +
    passosEmail_(passos) +
    botaoEmail_('Abrir o Boletim', ENDERECO_PAINEL) +
    notaEmail_('Depois do primeiro acesso, é só entrar com e-mail e senha. Em <b>Meu perfil</b> você escolhe receber por e-mail ' +
               'as notícias urgentes na hora ou um resumo semanal.');
  return {
    assunto: 'Seu acesso ao ' + NOME_SISTEMA + ' está liberado',
    texto: 'Olá, ' + nome + '!\n\n' + quem + ' liberou o seu acesso ao ' + NOME_SISTEMA + ' do CINEA: o painel que acompanha ' +
      'comunicados, notícias, editais e atos oficiais do MEC, INEP, CNE, CAPES, SEMESP, ABMES, ABED, FAPEMIG, CEE-MG e Diário Oficial.\n\n' +
      'Para entrar pela primeira vez:\n1. Abra ' + ENDERECO_PAINEL + '\n2. Clique em "Entrar" e depois em "Primeiro acesso", com este e-mail (' + email + ').\n' +
      '3. Você vai receber um código de 6 dígitos. Digite o código e crie a sua senha.\n\n' +
      'Depois disso, é só entrar com e-mail e senha. Se esquecer a senha, use "Esqueci a senha".' + rodapeTexto_(),
    html: emailHtml_({ previa: quem + ' liberou o seu acesso. Veja como entrar pela primeira vez.', titulo: 'Seu acesso está liberado', corpo: corpo,
                       rodape: 'Você recebeu este e-mail porque um administrador do CINEA cadastrou este endereço no ' + esc_(NOME_SISTEMA) + '.' })
  };
}

// ------------------------------------------------------------------- modelo: avisos --

/** Aviso na hora, resumo semanal ou exemplo (Meu perfil). itens = notícias do avisos.json. */
function emailAviso_(p, tipo, itens, exemplo, desde) {
  itens = itens.slice().sort(function (x, y) {
    return (x.prioridade === y.prioridade ? 0 : x.prioridade === 'urgente' ? -1 : 1) || (y.data > x.data ? 1 : y.data < x.data ? -1 : 0);
  });
  const c = COR_EMAIL, email = p.email.toLowerCase(), semanal = tipo === 'semanal';
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM');
  const inicio = Utilities.formatDate(new Date(desde ? Date.parse(desde) : Date.now() - 7 * DIA_MS), 'America/Sao_Paulo', 'dd/MM');
  const cancelar = ENDERECO_PAINEL + '#parar-avisos=' + chaveAvisos_(email);
  const escolha = descreverAvisos_(avisosDe_(p));
  const titulo = semanal ? 'Resumo da semana' : (itens.some(function (it) { return it.prioridade === 'urgente'; }) ? 'Notícia urgente no Boletim' : 'Novidade no Boletim');
  const intro = semanal
    ? 'De ' + inicio + ' a ' + hoje + ', o Boletim encontrou ' + contagem_(itens) + '.'
    : 'A última coleta do Boletim encontrou ' + contagem_(itens) + '.';
  const ola = 'Olá, ' + p.nome.split(' ')[0] + '!';

  const cartoes = itens.map(function (it) {
    const borda = it.prioridade === 'urgente' ? c.urgente : c.alta;
    const resumo = it.resumo ? it.resumo.slice(0, 280) + (it.resumo.length > 280 ? '…' : '') : '';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;border:1px solid ' + c.borda +
      ';border-left:4px solid ' + borda + ';border-radius:8px"><tr><td style="padding:12px 14px">' +
      '<div style="margin-bottom:6px">' + seloEmail_(it.prioridade) +
      '<span style="font-size:12px;color:' + c.suave + ';margin-left:8px">' + esc_(it.instituicao) + ' · ' + dataBr_(it.data) + (it.tipo ? ' · ' + esc_(it.tipo) : '') + '</span></div>' +
      '<a href="' + esc_(it.link) + '" style="font-size:16px;line-height:1.4;font-weight:600;color:' + c.marca + ';text-decoration:none">' + esc_(it.titulo) + '</a>' +
      (it.motivo_urgencia ? '<div style="font-size:13px;margin-top:6px;color:' + c.urgente + '"><b>Por que é urgente:</b> ' + esc_(it.motivo_urgencia) + '</div>' : '') +
      (resumo ? '<div style="font-size:14px;line-height:1.5;margin-top:6px;color:' + c.texto + '">' + esc_(resumo) + '</div>' : '') +
      '</td></tr></table>';
  }).join('');

  const corpo =
    (exemplo ? notaEmail_('<b>Este é um exemplo</b> do aviso que você escolheu, com as notícias mais recentes. Os avisos de verdade chegam sozinhos.', 'atencao') : '') +
    pEmail_(esc_(ola) + ' ' + esc_(intro)) +
    cartoes +
    botaoEmail_('Ver tudo no Boletim', ENDERECO_PAINEL);

  const texto = [ola, '', (exemplo ? 'Este é um EXEMPLO do aviso que você escolheu.\n\n' : '') + intro, '']
    .concat(itens.map(function (it) {
      return '• [' + ROTULO_PRIORIDADE[it.prioridade] + '] ' + it.instituicao + ' · ' + dataBr_(it.data) + '\n  ' + it.titulo +
        (it.motivo_urgencia ? '\n  Por que é urgente: ' + it.motivo_urgencia : '') + '\n  ' + it.link + '\n';
    }))
    .concat(['Ver tudo no painel: ' + ENDERECO_PAINEL, '',
      'Você recebe este e-mail porque escolheu, em "Meu perfil" no Boletim, receber avisos (' + escolha + ').',
      'Para mudar: entre no Boletim e abra Meu perfil > Avisos por e-mail.',
      'Para parar de receber todos os avisos: ' + cancelar]).join('\n') + rodapeTexto_();

  return {
    // Uma notícia só: o título dela vai no assunto (fica claro na caixa de entrada sem abrir).
    assunto: (exemplo ? '[Exemplo] ' : '') + (semanal
      ? 'Resumo da semana (' + inicio + ' a ' + hoje + '): ' + contagem_(itens)
      : (titulo === 'Notícia urgente no Boletim' ? 'Urgente: ' : 'Novidade: ') +
        (itens.length === 1 ? (itens[0].titulo.length > 90 ? itens[0].titulo.slice(0, 89) + '…' : itens[0].titulo) : contagem_(itens))),
    texto: texto,
    html: emailHtml_({
      previa: itens[0] ? itens[0].titulo : intro, titulo: titulo, corpo: corpo,
      rodape: 'Você recebe este e-mail porque escolheu, em Meu perfil, receber avisos (' + esc_(escolha) + '). ' +
        'Para mudar, entre no Boletim e abra <b>Meu perfil › Avisos por e-mail</b>. ' +
        '<a href="' + esc_(cancelar) + '" style="color:' + c.suave + '">Parar de receber todos os avisos</a>.'
    })
  };
}

/** Monta e manda um aviso (imediato ou resumo semanal) para uma pessoa. */
function enviarAviso_(p, tipo, itens, exemplo, desde) {
  enviarEmail_(p.email.toLowerCase(), emailAviso_(p, tipo, itens, exemplo, desde));
}

const API_ = {
  marcacoes: api_marcacoes_, marcar: api_marcar_, marcarLidos: api_marcarLidos_,
  perfil: api_perfil_, salvarMeuNome: api_salvarMeuNome_, alterarSenha: api_alterarSenha_, equipe: api_equipe_, salvarMembro: api_salvarMembro_,
  removerMembro: api_removerMembro_, apagarSenha: api_apagarSenha_, enviarBoasVindas: api_enviarBoasVindas_,
  registro: api_registro_, uso: api_uso_, salvarAvisos: api_salvarAvisos_, testarAvisos: api_testarAvisos_
};

// ======================================================================== porta de entrada --

/** Só para conferir se o servidor está no ar. */
function doGet() {
  return ContentService.createTextOutput('Servidor de acesso do ' + NOME_SISTEMA + ': no ar.');
}

/**
 * Porta única do painel: POST com JSON { acao, ... }.
 *   pedirCodigo { email } · definirSenha { email, codigo, senha } · entrar { email, senha } · sair { sessao }
 *   cancelarAvisos { chave } · api { nome, sessao, args }
 * Resposta: { ok: true, dados } ou { ok: false, erro } (SESSAO_INVALIDA = pedir login de novo).
 */
function doPost(e) {
  let resposta;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    resposta = { ok: true, dados: executar_(p) };
  } catch (err) {
    // Mensagens nossas (falha_) vão para a tela; erros internos ficam só no log.
    if (!(err && err.paraUsuario)) console.error(err);
    resposta = { ok: false, erro: err && err.paraUsuario ? err.message : 'Erro no servidor. Tente de novo em instantes.' };
  }
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(ContentService.MimeType.JSON);
}

function executar_(p) {
  switch (p.acao) {
    case 'cadastrar': { const email = emailLimpo_(p.email); return comTrava_(function () { return cadastrar_(p.nome, email); }); }
    case 'pedirCodigo': { const email = emailLimpo_(p.email); return comTrava_(function () { return pedirCodigo_(email); }); }
    case 'definirSenha': {
      const email = emailLimpo_(p.email), codigo = String(p.codigo || '').replace(/\D/g, '').slice(0, 6);
      return comTrava_(function () { return definirSenha_(email, codigo, p.senha); });
    }
    case 'entrar': { const email = emailLimpo_(p.email); return comTrava_(function () { return entrar_(email, p.senha); }); }
    case 'publico':  // painel aberto: o que um visitante sem login pode ver
      return publico_();
    case 'evento':   // uso do painel (equipe e visitantes); nunca devolve erro para a tela
      try { return evento_(p); } catch (e) { console.error(e); return false; }
    case 'cancelarAvisos':  // link "parar de receber" dos e-mails de aviso (sem login)
      return comTrava_(function () { return cancelarAvisos_(p.chave); });
    case 'sair':
      if (p.sessao) PropertiesService.getScriptProperties().deleteProperty('sessao:' + hmac_(p.sessao));
      return true;
    case 'api': {
      const f = Object.prototype.hasOwnProperty.call(API_, p.nome) ? API_[p.nome] : null;
      if (!f) throw falha_('Ação desconhecida.');
      const ss = planilha_();
      USUARIO_ATUAL_ = validarSessao_(ss, String(p.sessao || ''));
      return f.apply(null, [ss].concat(Array.isArray(p.args) ? p.args : []));
    }
    default:
      throw falha_('Ação desconhecida.');
  }
}
