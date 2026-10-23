# Observatório da Educação Superior (Radar da Educação Superior) · CINEA / NED · PUC Minas

Nome trocado em 23/10/2026 a pedido do Diego: título "Observatório da Educação Superior", com "Radar da Educação Superior"
como subtítulo. O endereço (…/radar-educacao-superior/) e os nomes internos (pasta, planilha, código) continuam "Radar".
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
| Repositório | https://github.com/certificacao-cinea/radar-educacao-superior (público, org `certificacao-cinea`, escolhida pelo Diego) |
| Painel | https://certificacao-cinea.github.io/radar-educacao-superior/ (GitHub Pages, pasta `docs/`) |
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
- **Antes de publicar mudanças em `docs/`, rode `python ferramentas/versao.py`.** O Pages guarda cada arquivo 10 min no
  navegador; sem o carimbo, a página nova com um script antigo quebrava o "Entrar" sem mostrar erro (relato do Diego, 23/10/2026).
  Com versões diferentes, o painel recarrega sozinho uma vez (`conferirVersao` em acesso.js).
- Hash da senha: 500 repetições (com 2000 a entrada demorava; cada hash guarda o próprio número, então os antigos valem).
- `clasp create` sobrescreve o `appsscript.json`: conferir antes do push.
- O token do clasp só tem `drive.file`: ele cria pastas, mas não move o script. Quem move é o `configurar()` (escopo `drive`).
- Para saber se o `configurar()` rodou: a planilha aparece na pasta; enquanto a cineaned não autorizar, o `/exec` responde "Acesso negado".

## Lições aprendidas
- Os portais gov.br do MEC e do CNE bloqueiam robôs (F5). Por isso a coleta usa o RSS do Google Notícias por site.
- A busca do DOU recusa (403) pedidos sem o cabeçalho `Accept`.
- A org `certificacao-cinea` bloqueia permissão de escrita *padrão* para workflows; o `permissions:` explícito no YAML funciona.
- O Google Notícias devolve itens antigos às vezes: descartar os de fora da retenção antes de contar como novos.
- Atos de rotina do DOU citam "portaria normativa", DCNs etc. na fundamentação: termos críticos não valem para rotina.
