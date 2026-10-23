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
const ENDERECO_PAINEL = 'https://certificacao-cinea.github.io/radar-educacao-superior/';
// Nome que as pessoas veem (o endereço continua "radar-educacao-superior" para não quebrar links já enviados).
const NOME_SISTEMA = 'Observatório da Educação Superior';
const REMETENTE = 'Observatório · CINEA | PUC Minas';
const NOME_PLANILHA = 'Radar da Educação Superior - Acesso (não mexer)';
// Pasta "Radar da Educação Superior" no Drive da cineaned: tudo do Radar no Google fica nela (script e planilha).
const PASTA_ID = '1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe';
// Cadastrados como administradores na primeira execução de configurar().
const ADMINS_INICIAIS = [{ email: 'diegoeduardo@pucminas.br', nome: 'Diego Eduardo' }];

const ABAS = {
  // senha = hash (nunca a senha); senha_em = quando foi criada ou trocada
  Equipe: ['email', 'nome', 'admin', 'cadastrado_por', 'cadastrado_em', 'boasvindas_em', 'senha', 'senha_em', 'ultimo_acesso'],
  Registro: ['quando', 'quem', 'acao', 'detalhe'],
  // Marcações da equipe (compartilhadas): notícia sinalizada ou sem relevância, com quem marcou e por quê
  Marcacoes: ['item_id', 'tipo', 'por', 'em', 'motivo', 'titulo', 'link'],
  // Notícias lidas pela equipe (compartilhado): quem leu primeiro e quando. Uma linha por notícia.
  Lidos: ['email', 'item_id', 'em']
};

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
 * guarda o script e a planilha na pasta do Radar e autoriza o envio de e-mail. Pode rodar de novo sem estragar nada.
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
    equipe.sh.appendRow(linha_([a.email, a.nome, true, CONTA_SISTEMA, agora_(), '', '', '', '']));
  });
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
    dados: l || { codigos: 0, recusas: 0, e: {} },
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
    throw falha_('Este e-mail não está cadastrado no Observatório. Confira se digitou certo ou peça acesso a um administrador.');
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
  MailApp.sendEmail(email, NOME_SISTEMA + ': código ' + codigo,
    'Seu código para criar ou trocar a senha do ' + NOME_SISTEMA + ' (CINEA) é:\n\n' + codigo +
    '\n\nEle vale por ' + CODIGO_MINUTOS + ' minutos e só deve ser digitado em ' + ENDERECO_PAINEL +
    '\nNão repasse este código a ninguém: a equipe do CINEA nunca pede este código por telefone, mensagem ou e-mail.' +
    '\nSe você não pediu este código, ignore este e-mail: sua senha continua a mesma.',
    { name: REMETENTE });
  registrar_(ss, 'codigo_enviado', 'Pediu código para criar ou trocar a senha');
  return { ok: true };
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
  if (!podeEntrar_(ss, email)) throw falha_('Este e-mail não está mais cadastrado no Observatório.');
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
    registrar_(ss, 'acesso', 'Abriu o Observatório');
    const m = membro_(ss, USUARIO_ATUAL_);
    if (m.p) { m.p.ultimo_acesso = agora_(); salvarCampos_(m.tab, m.p, ['ultimo_acesso']); }
  } catch (e) { /* auxiliar */ }
}

// ==================================================================== ações com sessão --

function perfil_(ss, email) {
  const m = membro_(ss, email).p;
  return { email: email, nome: m ? m.nome : 'Conta do sistema', admin: ehAdmin_(ss, email), sistema: email === CONTA_SISTEMA,
           cadastrado_em: m ? m.cadastrado_em : '', cadastrado_por: m ? m.cadastrado_por : '',
           senha_em: m ? m.senha_em : prop_('SENHA_SISTEMA_EM') || '', ultimo_acesso: m ? m.ultimo_acesso : '' };
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
             senha_em: p.senha_em, ultimo_acesso: p.ultimo_acesso };
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}

function api_salvarMembro_(ss, email, nome, admin, boasVindas) {
  exigirAdmin_(ss);
  email = emailLimpo_(email);
  nome = String(nome || '').trim().slice(0, 120);
  if (!nome) throw falha_('Digite o nome da pessoa.');
  if (email === CONTA_SISTEMA) throw falha_('A conta do sistema já é administradora e não entra na lista.');
  const m = membro_(ss, email);
  if (m.p) {
    if (m.p.email === USUARIO_ATUAL_ && verdadeiro_(m.p.admin) && !admin && ultimoAdmin_(m.tab)) throw falha_('Você é o único administrador: cadastre outro antes de tirar o seu.');
    const antes = m.p.nome + (verdadeiro_(m.p.admin) ? ' (admin)' : '');
    m.p.nome = nome; m.p.admin = !!admin;
    salvarCampos_(m.tab, m.p, ['nome', 'admin']);
    registrar_(ss, 'membro_alterado', email + ': ' + antes + ' → ' + nome + (admin ? ' (admin)' : ''));
  } else {
    m.tab.sh.appendRow(linha_([email, nome, !!admin, USUARIO_ATUAL_, agora_(), '', '', '', '']));
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
  MailApp.sendEmail(email, 'Você agora tem acesso ao ' + NOME_SISTEMA,
    'Olá, ' + m.p.nome + '!\n\n' + quem + ' liberou seu acesso ao ' + NOME_SISTEMA + ' do CINEA (Radar da Educação Superior): o painel que acompanha ' +
    'comunicados, notícias, editais e atos oficiais do MEC, INEP, CNE, CAPES, SEMESP, ABMES, ABED, FAPEMIG, CEE-MG e Diário Oficial.\n\n' +
    'Para entrar pela primeira vez:\n' +
    '1. Abra ' + ENDERECO_PAINEL + '\n' +
    '2. Clique em "Primeiro acesso" e digite este e-mail (' + email + ').\n' +
    '3. Você vai receber um código de 6 dígitos. Digite o código e crie sua senha.\n\n' +
    'Depois disso, é só entrar com e-mail e senha. Se esquecer a senha, use "Esqueci a senha".\n\n' +
    'CINEA · Núcleo de Educação Digital · PUC Minas',
    { name: REMETENTE });
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

const API_ = {
  marcacoes: api_marcacoes_, marcar: api_marcar_, marcarLidos: api_marcarLidos_,
  perfil: api_perfil_, salvarMeuNome: api_salvarMeuNome_, alterarSenha: api_alterarSenha_, equipe: api_equipe_, salvarMembro: api_salvarMembro_,
  removerMembro: api_removerMembro_, apagarSenha: api_apagarSenha_, enviarBoasVindas: api_enviarBoasVindas_,
  registro: api_registro_
};

// ======================================================================== porta de entrada --

/** Só para conferir se o servidor está no ar. */
function doGet() {
  return ContentService.createTextOutput('Servidor de acesso do ' + NOME_SISTEMA + ': no ar.');
}

/**
 * Porta única do painel: POST com JSON { acao, ... }.
 *   pedirCodigo { email } · definirSenha { email, codigo, senha } · entrar { email, senha } · sair { sessao }
 *   api { nome, sessao, args }
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
    case 'pedirCodigo': { const email = emailLimpo_(p.email); return comTrava_(function () { return pedirCodigo_(email); }); }
    case 'definirSenha': {
      const email = emailLimpo_(p.email), codigo = String(p.codigo || '').replace(/\D/g, '').slice(0, 6);
      return comTrava_(function () { return definirSenha_(email, codigo, p.senha); });
    }
    case 'entrar': { const email = emailLimpo_(p.email); return comTrava_(function () { return entrar_(email, p.senha); }); }
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
