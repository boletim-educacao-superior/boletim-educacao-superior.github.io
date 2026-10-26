# Boletim da Educação Superior (Radar da Educação Superior) · CINEA / NED · PUC Minas

Nome trocado em 23/10/2026 a pedido do Diego: primeiro "Observatório", depois (mesmo dia) **"Boletim da Educação Superior"**
(ele achou "Observatório" estranho; queria algo de notícias e informes), com "Radar da Educação Superior"
como subtítulo — trocado depois por **"Centro de Inovação em Ensino e Aprendizagem (CINEA) - NED (PUC Minas)"**.
Endereço trocado no mesmo dia para **…/boletim-educacao-superior/** (repositório renomeado); o antigo
**…/radar-educacao-superior/** virou um repositório só com uma página que redireciona (mantém #seção e ?parâmetros).
Em 26/10/2026 ganhou **domínio próprio**, https://boletim-educacao-superior.github.io/ (o Diego queria mandar o link
para pessoas de fora sem ligação com o projeto de certificados): repositório transferido para a organização
`boletim-educacao-superior` e renomeado para `boletim-educacao-superior.github.io`; os dois endereços antigos redirecionam.
Os nomes internos (pasta local, pacote `radar/`, planilha, pasta do Drive) continuam "Radar".
Desde a mesma data, "Lida" também é compartilhada pela equipe (como Sinalizada e Sem relevância).

Contexto para retomar o trabalho em qualquer sessão. A conta do Claude é compartilhada: **não usar a memória do Claude**,
o contexto fica neste arquivo (mesma regra do sistema de certificados, em `Documents/certificados-ned/CLAUDE.md`).

## Quem e para quê
- Diego Eduardo (Tecnologias e Experiências de Aprendizagem do CINEA, NED/Prograd, PUC Minas) é o responsável.
- Quem usa é o **Hub de Integração e Relacionamento**, que cuida da atividade "Articulação com instituições e entidades da
  educação superior (MEC, INEP, SEMESP, ABMES, ABED)". O João (gestão) quer a equipe a par de ações, comunicados, notícias e editais.
- NED = Núcleo de **Educação Digital** (não "de EAD"). O CINEA tem três setores: Hub; Inovação Pedagógica e Formação Continuada;
  Tecnologias e Experiências de Aprendizagem. Documento de referência: `Downloads/Contextualizacao_CINEA_Setores_e_Atuacao.md`.

## Restrições combinadas (23/10/2026)
- Script automatizado e **sem custo**, fácil de manter, sem depender de bancos ou sistemas internos.
- **Não usar o Monday** para isso (o Diego verificou).
- Entrega numa página web (plano B: e-mail). Coleta sob demanda + automática só para alertar urgentes.

## Onde está cada coisa
| Parte | Local |
|---|---|
| Repositório | https://github.com/boletim-educacao-superior/boletim-educacao-superior.github.io (público; organização própria, criada pelo Diego em 26/10/2026, dona = conta pessoal Diegoeduardosc) |
| Painel | https://boletim-educacao-superior.github.io/ (GitHub Pages na raiz do domínio, pasta `docs/`) |
| Redirecionamentos | https://github.com/certificacao-cinea/radar-educacao-superior e https://github.com/certificacao-cinea/boletim-educacao-superior (só `index.html`/`404.html` que mandam para o domínio novo; não pôr código nem dados) |
| Coleta | GitHub Actions `.github/workflows/coleta.yml` (manual + todo dia às 4h de Brasília, desde 23/10/2026; antes: dias úteis 8h/12h/17h) |
| Fontes e regras | `config/fontes.toml`, `config/regras.toml` |
| Pasta no Drive (cineaned) | **Radar da Educação Superior**, `1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe`: script de acesso e planilha da equipe (pedido do Diego: centralizar tudo do Radar) |
| Acesso (login) | Apps Script na conta cineaned, `acesso/` (ver `acesso/README.md`). Painel: `docs/acesso.js` |

## Acesso (23/10/2026)
- Pedido do Diego: página de acesso com controle de usuário, cadastro de senha e admin, "usando a lógica da certificação".
- Decisões dele: **só tela de entrada** (os dados continuam públicos; ele foi avisado de que isso não protege os dados),
  **senha + código** por e-mail no primeiro acesso e no "esqueci a senha", **equipe própria** (planilha separada da certificação).
- A cota de e-mail da cineaned é compartilhada com os certificados: o Radar reserva 30 e manda no máximo 20 códigos por dia.
- Topo depois de entrar (pedido do Diego, "mesma lógica do certificado"): "Conectado como" + nome (abre Meu perfil) · sair
  + etiqueta do perfil, sigla do nome num círculo e engrenagem com Meu perfil, Alterar senha e, só para admin, Equipe e Registro.
  No celular ficam só a sigla e a engrenagem. Meu perfil troca só o próprio nome (`salvarMeuNome`).
- Menu (pedido do Diego): Início · Sinalizadas · Não lidas · Lidas · Sem relevância, com endereço próprio (#sinalizadas...).
  Decisão minha, avisada a ele: **sinalizada e sem relevância são da equipe** (abas `Marcacoes`), **lida é por pessoa**
  (aba `Lidos`), as duas no servidor. Sinalizada e sem relevância não convivem. Os motivos de "sem relevância" servem para ajustar `regras.toml`.
- Administrador é página própria (`#admin`), aberta pela engrenagem (itens "Administrador" e "Registro de atividades").
- Agenda abaixo de "Última coleta": o coletor lê a linha `cron` do coleta.yml e grava `agenda` no status.json (horário de Brasília).
- Logo depois de `clasp update-deployment`, o `/exec` pode responder por alguns segundos com uma página de erro do Drive: é passageiro.
- Varredura retroativa (pedido do Diego, 23/10/2026): `python -m radar --desde 2026-01-01`. Google Notícias aceita
  `after:`/`before:` (máx. ~100 por busca: períodos de 15 dias, divididos se lotar); DOU aceita período `personalizado`
  mas **não pagina** (máx. 20): semanas, divididas até dia a dia. `manter_desde = "2026-01-01"` segura o histórico.
  Texto integral do DOU fica em `dados/textos_dou.json` (fora de docs/, o painel não baixa).
- Topo (pedido do Diego, 23/10/2026): título | conta + engrenagem + tema; segunda linha com Última coleta, Coleta automática e
  Próxima atualização (cada uma numa linha) e "Coletar agora" alinhado à direita da página. Tema como nos certificados: abre
  sempre claro, escuro só para quem escolhe (`radar.tema` no navegador). Busca com botão; lista com 20 notícias por página.
- Painel mostra só **urgente e alta** (`PRIORIDADE_MINIMA` em app.js; pedido do Diego, 23/10/2026). Média e baixa ficam nos
  dados e reaparecem se a triagem subir a prioridade. "Coletar agora" fica na linha do menu, à direita.
- **Painel aberto** (pedido do Diego, 23/10/2026): sem login vê o Início (urgente/alta); ações (sinalizar, sem relevância,
  lida), abas da equipe, "novos desde a sua última visita" e "Coletar agora" pedem login. Servidor: `publico` (só ids sem
  relevância, sem nomes), `evento` (uso: abertura, visao, noticia, busca, csv; aba `Acessos`, visitante = id aleatório por
  navegador) e `uso` (relatório agregado, só admin). "Última visita" = coluna `visita_anterior` da Equipe (nova visita
  após 30 min). Entrar ou sair recarrega a página. A aba `Acessos` cresce sem limite: se ficar lenta, arquivar linhas antigas.
- **Cadastro aberto** (pedido do Diego, 23/10/2026; ele escolheu "qualquer e-mail" e "marcações pessoais"): qualquer pessoa
  cria conta em "Criar minha conta" (ação `cadastrar`, máx. 15/dia por causa da cota da cineaned). Perfis (`tipoDe_`):
  admin · equipe (cadastrada pelo admin, marca para todos) · usuario (coluna `perfil`='usuario': sinaliza e marca lidas só
  para si, aba `Pessoais`; não marca sem relevância; não vê "Coletar agora"). Admin promove ("Tornar equipe CINEA") ou rebaixa.
  Visitante vê as abas da equipe com cadeado (convite para criar conta).
- **Avisos por e-mail** (pedido do Diego, 26/10/2026): cada pessoa com conta escolhe em Meu perfil (ou engrenagem ›
  Avisos por e-mail) uma grade prioridade × frequência: urgente e/ou alta, **na hora** (depois de cada coleta) e/ou
  **resumo semanal** (segundas, 8h, só se houver novidade). Colunas `avisos_imediato` / `avisos_semanal` da Equipe
  ("urgente,alta"). O coletor grava `docs/dados/avisos.json` (urgente e alta, 35 dias); o Apps Script lê esse arquivo
  (UrlFetchApp, escopo `script.external_request`) em dois gatilhos criados por `configurar()` (escopo `script.scriptapp`):
  `verificarAvisos` a cada 15 min (manda o que tem `visto_em` maior que a propriedade `AVISOS_ULTIMO`; na primeira vez só
  marca o ponto de partida) e `resumoSemanal`. Sem relevância não entra. Sem cota (reserva de 30 dos certificados), o
  aviso espera na fila `AVISOS_FILA`. Rodapé tem link `#parar-avisos=<HMAC do e-mail>`: o painel confirma e chama
  `cancelarAvisos` (sem login). "Enviar um exemplo para mim": até 3 por dia. A issue no GitHub continua existindo.
- **Modelos de e-mail** (26/10/2026): todos saem do molde `emailHtml_` no Acesso.gs (cores do painel, tema claro;
  tabelas e estilos na linha, para Gmail/Outlook) + versão em texto. Modelos: `emailCodigo_` (cadastro / primeiro acesso /
  troca de senha, escolhido pelo servidor), `emailBoasVindas_`, `emailAviso_` (na hora, resumo semanal, exemplo).
  Sem "Por que é urgente" nos avisos (pedido do Diego, 26/10/2026). Prévia de todos: `node acesso/teste/previa-emails.js` → `acesso/teste/previa-emails.html` (fora do git).
  O simulador do Google dos testes fica em `acesso/teste/ambiente.js`.
- Ajustes de 26/10/2026 (pedido do Diego): todo mundo abre em "Urgente e alta" + "Últimos 30 dias", urgentes primeiro
  (filtros não são guardados entre visitas); legenda "Indicadores dos últimos 30 dias. Para mudar, use o filtro "Período"";
  o que é Urgente/Alta fica num ícone (i) discreto ao lado do filtro "Prioridade" (balão ao clicar); texto do Início pensado para quem é de fora; "Coletar agora" virou
  **"Verificar novas notícias"** e só aparece para administradores (classe `so-admin` + `body.perfil-admin`);
  assinatura em duas linhas: "Centro de Inovação em Ensino e Aprendizagem (CINEA)" / "Núcleo de Educação Digital (NED) - PUC Minas"
  (no site e nos e-mails).
- **Antes de publicar mudanças em `docs/`, rode `python ferramentas/versao.py`.** O Pages guarda cada arquivo 10 min no
  navegador; sem o carimbo, a página nova com um script antigo quebrava o "Entrar" sem mostrar erro (relato do Diego, 23/10/2026).
  Com versões diferentes, o painel recarrega sozinho uma vez (`conferirVersao` em acesso.js).
- Hash da senha: 500 repetições (com 2000 a entrada demorava; cada hash guarda o próprio número, então os antigos valem).
- `clasp create` sobrescreve o `appsscript.json`: conferir antes do push.
- O token do clasp só tem `drive.file`: ele cria pastas, mas não move o script. Quem move é o `configurar()` (escopo `drive`).
- Para saber se o `configurar()` rodou: a planilha aparece na pasta; enquanto a cineaned não autorizar, o `/exec` responde "Acesso negado".

## Pendências
Ver `BACKLOG.md`. Os avisos por e-mail foram feitos em 26/10/2026; falta o domínio próprio (organização no GitHub).

## Lições aprendidas
- Os portais gov.br do MEC e do CNE bloqueiam robôs (F5). Por isso a coleta usa o RSS do Google Notícias por site.
- A busca do DOU recusa (403) pedidos sem o cabeçalho `Accept`.
- A org `certificacao-cinea` bloqueia permissão de escrita *padrão* para workflows; o `permissions:` explícito no YAML funciona.
- O Google Notícias devolve itens antigos às vezes: descartar os de fora da retenção antes de contar como novos.
- Atos de rotina do DOU citam "portaria normativa", DCNs etc. na fundamentação: termos críticos não valem para rotina.
