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

## Primeira configuração (uma vez, logado como cineaned)

1. Abra o projeto no editor (link acima).
2. No topo, escolha a função **`configurar`** e clique em **Executar**.
3. Autorize: *Revisar permissões* › conta cineaned › *Avançado* › *Acessar Radar da Educação Superior - Acesso (não seguro)* › *Permitir*.
   O Google chama de "não seguro" todo script que não passou por verificação; é o mesmo aviso do sistema de certificados.
4. No *Registro de execução* aparece "Pronto. Pasta: … · Planilha: …". O `configurar()` também move o próprio script
   para a pasta do Radar. Diego Eduardo já entra como administrador.
   Se a execução terminar sem a janela de autorização e sem esse "Pronto", a função escolhida não era a `configurar`.
5. Teste em https://certificacao-cinea.github.io/boletim-educacao-superior/ › *Primeiro acesso*.

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

## Testes

- `node acesso/teste/testar.js`: simula os serviços do Google e confere 51 regras (senhas, códigos, bloqueios,
  sessões, administração, cota, erros internos).
- Telas sem o Google: sirva `docs/` (`python -m http.server 8791 --directory docs`) e abra
  `http://localhost:8791/?acesso=simulado`. O código "enviado por e-mail" aparece no console do navegador.
  Pessoas do simulador: diegoeduardo@pucminas.br (admin, sem senha: use Primeiro acesso) e
  ana.teste@pucminas.br (senha `teste2026ok`).
