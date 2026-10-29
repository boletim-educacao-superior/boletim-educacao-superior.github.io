# Servidor de acesso do Radar

Controla **quem entra** no painel: equipe, senhas, primeiro acesso, "esqueci a senha" e administradores.
Roda no Google Apps Script, na conta **cineaned@gmail.com**, igual ao Painel do sistema de certificados.

> O painel é **aberto** (decisão de 23/10/2026): qualquer pessoa vê as notícias. A entrada serve para a equipe
> marcar notícias (compartilhado), ver as áreas da equipe e administrar. Os dados são públicos no GitHub.

Ações públicas (sem sessão): `publico` (ids marcados como sem relevância, sem nomes; cache de 60 s) e `evento`
(registro de uso na aba `Acessos`, com limite por navegador e por minuto; nunca devolve erro). O relatório
`uso` (só administradores) agrega essa aba: acessos por dia, mapa de calor (dia da semana × hora), equipe x
visitantes, dispositivos, seções, notícias, instituições e buscas.

| | |
|---|---|
| Projeto (editor) | https://script.google.com/d/189yujMyAlzHxfUIuC5Tg5yKlBHY0f5-opPBlLs_B-oMBr4PAkQRQeOtK/edit |
| App da Web (`/exec`) | `https://script.google.com/macros/s/AKfycbxgKFOecHcd4-nfNhmtiZbPWP8F9J4AX2Y5Wjm6iJDDXgfig6tNl6zcC7sb4lSmS-3Q/exec` |
| Implantação | `AKfycbxgKFOecHcd4-nfNhmtiZbPWP8F9J4AX2Y5Wjm6iJDDXgfig6tNl6zcC7sb4lSmS-3Q` |
| Pasta no Drive | **Radar da Educação Superior** (cineaned): https://drive.google.com/drive/folders/1yCblAdeKF9ZPn2Ao_4ft5-KL-7HB9Boe. Tudo do Radar no Google fica aqui (`PASTA_ID` no `Acesso.gs`) |
| Planilha | "Radar da Educação Superior - Acesso (não mexer)", criada por `configurar()` dentro da pasta |

## Como funciona

- **Equipe** (aba da planilha): quem pode entrar, nome, administrador, hash da senha, último acesso.
  A senha nunca é guardada: só um hash (sal próprio + segredo do servidor + HMAC repetido 2.000 vezes).
- **Primeiro acesso / esqueci a senha:** e-mail → código de 6 dígitos por e-mail (15 min, 5 tentativas)
  → a pessoa cria a senha → já entra.
- **Entrada:** e-mail e senha. A mensagem de erro é a mesma para e-mail desconhecido e senha errada.
  Após 5 erros seguidos, o e-mail fica bloqueado por 15 minutos; após 20 erros no dia, só no dia seguinte.
- **Sessão:** 30 dias desde o último uso, guardada no navegador e, no servidor, só como hash.
  Cai na hora se a pessoa sair da equipe, se trocar a senha (em outro navegador) ou se um administrador apagar a senha dela.
- **Administradores:** cineaned sempre; os demais marcados na Equipe. Cadastram e removem pessoas, dão ou tiram o perfil de
  administrador, reenviam o e-mail de boas-vindas, apagam a senha de alguém e veem o registro de atividades.
- **Cota de e-mail:** é a MESMA do sistema de certificados (mesma conta, ~100 por dia). O Radar não envia nada
  quando restam 30 ou menos (reserva para os certificados) e manda no máximo 20 códigos por dia.
- **Avisos por e-mail:** cada pessoa escolhe em *Meu perfil* (urgente e/ou alta; na hora e/ou resumo semanal).
  O coletor publica `dados/avisos.json`; o gatilho `verificarAvisos` (a cada 15 min) manda o aviso imediato quando
  aparece notícia nova, e o `resumoSemanal` (segundas, 8h) manda o resumo da semana só para quem tem novidade.
  Respeitam a reserva de 30 e-mails dos certificados: o que não couber no dia espera na fila (`AVISOS_FILA`).
  O rodapé de cada aviso tem o link "parar de receber". Os gatilhos são criados pelo `configurar()`
  (confira em *Acionadores*, o ícone de relógio no editor).
- **Segredo:** o código está num repositório público, então o segredo fica só nas propriedades do script
  (`SEGREDO`, criado por `configurar()`). Nunca escreva segredos no `Acesso.gs`.
- **Verificar novas notícias (botão dos administradores):** o servidor dispara a coleta no GitHub Actions
  (`coletarAgora`), no máximo 2 vezes por hora somando todos (`COLETAS_MANUAIS` guarda os horários). Precisa da
  propriedade `GITHUB_TOKEN`: token *fine-grained* criado no GitHub (Settings › Developer settings › Fine-grained tokens),
  dono `boletim-educacao-superior`, só o repositório `boletim-educacao-superior.github.io`, permissão **Actions: Read and write**.
  Cole o valor em *Configurações do projeto* › *Propriedades do script* (nome `GITHUB_TOKEN`). Quando o token expirar,
  o botão avisa que o GitHub recusou: gere outro e troque o valor.

## Primeira configuração (uma vez, logado como cineaned)

1. Abra o projeto no editor (link acima).
2. No topo, escolha a função **`configurar`** e clique em **Executar**.
3. Autorize: *Revisar permissões* › conta cineaned › *Avançado* › *Acessar Radar da Educação Superior - Acesso (não seguro)* › *Permitir*.
   O Google chama de "não seguro" todo script que não passou por verificação; é o mesmo aviso do sistema de certificados.
4. No *Registro de execução* aparece "Pronto. Pasta: … · Planilha: …". O `configurar()` também move o próprio script
   para a pasta do Radar. Diego Eduardo já entra como administrador.
   Se a execução terminar sem a janela de autorização e sem esse "Pronto", a função escolhida não era a `configurar`.
5. Teste em https://boletim-educacao-superior.github.io/ › *Primeiro acesso*.

## Publicar uma alteração

```bash
cd acesso
node teste/testar.js
clasp push --force
clasp update-deployment AKfycbxgKFOecHcd4-nfNhmtiZbPWP8F9J4AX2Y5Wjm6iJDDXgfig6tNl6zcC7sb4lSmS-3Q --description "o que mudou"
```

O clasp precisa estar logado na conta cineaned (`clasp show-authorized-user`). Se mudar as permissões no
`appsscript.json`, rode `configurar` de novo no editor para autorizar.

**Cuidado:** o `clasp create`/`clasp pull` troca o `appsscript.json` pelo padrão do Google (fuso de Nova York, sem
permissões nem configuração de App da Web). Confira o arquivo antes de fazer `push`.

## Modelos de e-mail

Todos os e-mails seguem o mesmo visual (o do painel): cabeçalho com o nome do Boletim e o CINEA, título, conteúdo,
botão e rodapé. Ficam no `Acesso.gs`, seção "e-mails (padrão visual)":

| Modelo | Quando sai |
|---|---|
| Código: cadastro novo | quem criou a própria conta |
| Código: primeiro acesso | quem foi cadastrado por um administrador e ainda não tem senha |
| Código: troca de senha | "Esqueci a senha" |
| Boas-vindas | administrador cadastra alguém (ou "Reenviar boas-vindas") |
| Inscrição nos avisos | administrador inscreve alguém sem mandar boas-vindas (ex.: gestor que só quer os e-mails) |
| Aviso na hora | depois da coleta, para quem marcou "Na hora" |
| Resumo semanal | segundas, 8h, só para quem teve novidade |
| Exemplo | "Enviar um exemplo para mim", em Meu perfil |

Para ver todos antes de publicar: `node acesso/teste/previa-emails.js` e abra `acesso/teste/previa-emails.html`.

## Testes

- `node acesso/teste/testar.js`: simula os serviços do Google e confere 51 regras (senhas, códigos, bloqueios,
  sessões, administração, cota, erros internos).
- Telas sem o Google: sirva `docs/` (`python -m http.server 8791 --directory docs`) e abra
  `http://localhost:8791/?acesso=simulado`. O código "enviado por e-mail" aparece no console do navegador.
  Pessoas do simulador: diegoeduardo@pucminas.br (admin, sem senha: use Primeiro acesso) e
  ana.teste@pucminas.br (senha `teste2026ok`).
