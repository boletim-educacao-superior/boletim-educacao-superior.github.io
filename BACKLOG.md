# Pendências do Boletim da Educação Superior

## 1. Preferências e resumo por e-mail: FEITO em 26/10/2026

Implementado como o Diego pediu: grade prioridade (urgente / alta) × frequência (na hora / resumo semanal) em
Meu perfil. Detalhes no CLAUDE.md e em acesso/README.md. O texto abaixo é o histórico da proposta.

Pendente: quando os avisos estiverem rodando bem, decidir se a issue de alerta no GitHub continua (`ALERTA_GITHUB=0`).
Atenção à cota de e-mail (~100/dia, dividida com os certificados) se o número de assinantes crescer.

## Histórico: proposta de 23/10/2026

**Atualização (23/10/2026, noite):** com o cadastro aberto, a ideia do Diego é que **cada pessoa com conta** (equipe ou
usuário) defina as próprias preferências e escolha receber um resumo **diário, semanal, mensal ou trimestral**
(mais o alerta imediato de urgentes). O que está abaixo continua valendo como base; a inscrição passa a ser em
"Meu perfil" com a frequência escolhida. Atenção redobrada com a cota de e-mail: com muitos usuários, a cineaned
(~100/dia, dividida com os certificados) não dá conta. Avaliar outro remetente antes de abrir para todos.

**Situação hoje:** ninguém recebe notícias por e-mail. O alerta de urgente só abre uma *issue* no GitHub
(chega por e-mail apenas para quem "observa" o repositório), e o envio por SMTP em `radar/alertas.py`
nunca foi configurado. O Diego vai testar o sistema como está antes de decidir.

**Proposta apresentada:**
- **Inscrição em "Meu perfil"**, com duas opções: ☐ resumo semanal · ☐ alerta imediato de urgentes.
  Na página do Administrador, a lista da equipe mostra quem está inscrito em cada um.
- **Envio pelo servidor de acesso** (Apps Script na conta cineaned, MailApp), como os códigos de acesso.
  Gatilho semanal (sugestão: segunda às 8h) lendo `docs/dados/itens.json` publicado (UrlFetchApp)
  e as marcações da equipe (abas `Marcacoes` e `Lidos`).
- **Conteúdo do resumo:** urgentes da semana, sinalizadas pela equipe (com quem sinalizou), prioridade alta,
  contagem por instituição e link para o painel; rodapé explicando como parar de receber.
  Assunto: "Boletim da Educação Superior · Resumo da semana (dd a dd/mm)".
- **Alerta imediato:** curto, só os urgentes novos, logo depois da coleta das 4h.
- Com o alerta por e-mail funcionando, desligar a issue no GitHub (`ALERTA_GITHUB=0`).

**Antes de implementar, confirmar com o Diego:**
1. Dia e horário do resumo (sugestão: segunda, 8h).
2. Conteúdo: os blocos acima bastam? Incluir itens por setor do CINEA?
3. Alerta imediato entra junto ou fica só o resumo?

**Cuidados:**
- Nova permissão do Google (`script.external_request`, para o UrlFetchApp): rodar `configurar()` de novo como cineaned.
- Cota de e-mail compartilhada com os certificados (~100/dia): manter a reserva de 30 (`RESERVA_CERTIFICADOS`).
- Nunca enviar e-mails de teste para endereços inventados.
