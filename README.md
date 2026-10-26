# Boletim da Educação Superior · Radar da Educação Superior

Monitoramento automático de comunicados, notícias, editais e atos oficiais de
**MEC, INEP, CNE, CAPES, SEMESP, ABMES, ABED, FAPEMIG, CEE-MG e Diário Oficial
da União**, com triagem por relevância para o CINEA e indicação do setor que
deve acompanhar cada item.

Mantido pelo **Hub de Integração e Relacionamento** do CINEA (Centro de
Inovação em Ensino e Aprendizagem), no NED (Núcleo de Educação Digital) da
Prograd — PUC Minas. Apoia a atividade *"Articulação com instituições e
entidades da educação superior"* e a preparação dos cursos para avaliações do MEC.

- **Custo:** zero (GitHub Actions + GitHub Pages, plano gratuito).
- **Dependências:** nenhuma além do Python 3.11+. Não usa banco de dados.
- **Painel web:** página estática com filtros, busca, "novos desde a última
  visita", marcação de lidos e exportação para CSV/Excel.
- **Alertas:** só para itens **urgentes**, por issue do GitHub (que gera e-mail)
  e, opcionalmente, por e-mail via SMTP.

---

## Acesso ao painel

O painel é **aberto**: qualquer pessoa vê as notícias (urgentes e de prioridade alta) sem login, e qualquer
pessoa pode **criar a própria conta** (perfil Usuário: sinalizadas e lidas pessoais). A equipe do CINEA é
cadastrada pelo administrador e suas marcações valem para todos.
**Entrar** (canto direito) é para a equipe do CINEA: sinalizar, marcar como sem relevância ou lida (compartilhado
com todos), ver as abas da equipe e o "novos desde a sua última visita" (calculado pelo registro de acesso).
Quem cadastra as pessoas é um administrador. A pessoa cadastrada recebe um e-mail de boas-vindas, clica em
**Primeiro acesso**, recebe um código e cria a própria senha. "Esqueci a senha" funciona do mesmo jeito.

**Avisos por e-mail:** quem tem conta escolhe em *Meu perfil › Avisos por e-mail* o que quer receber:
notícias **urgentes** e/ou de **prioridade alta**, **na hora** (logo depois de cada coleta) e/ou num **resumo
semanal** (segundas, 8h, só quando há novidade). Cada e-mail tem o link para parar de receber.

Os administradores têm o **Uso da plataforma** (engrenagem › Uso da plataforma): acessos, mapa de calor por
dia da semana e hora, equipe x visitantes, celular x computador, o que mais se abre e busca. Visitantes são
contados por navegador (um número aleatório, sem nenhum dado pessoal).

O servidor de acesso é um Google Apps Script na conta cineaned, com a mesma lógica do sistema de certificados.
Detalhes, configuração e manutenção em [acesso/README.md](acesso/README.md).

> A entrada organiza **quem usa** o Radar, mas os dados continuam públicos neste repositório.

## Como funciona

```
 Google Notícias (RSS por site) ─┐
                                 ├─► coletor (Python) ─► triagem por regras ─► docs/dados/itens.json ─► painel (GitHub Pages)
 Diário Oficial da União ────────┘                                         └─► alerta se houver URGENTE novo
```

1. **Coleta.** Os portais gov.br (MEC, CNE) bloqueiam robôs, e quase nenhuma
   fonte tem RSS próprio. Por isso o Radar usa:
   - o **RSS do Google Notícias filtrado por site** (`site:abmes.org.br` etc.),
     que funciona para todas as instituições;
   - a **busca do DOU** (in.gov.br), fonte primária de portarias, pareceres e
     editais. Para cada ato novo o Radar também baixa o texto integral, para a
     triagem saber de qual IES e de qual modalidade o ato trata.
2. **Triagem.** Regras de palavras-chave em `config/regras.toml` definem os
   temas, o tipo de documento, a prioridade (urgente, alta, média ou baixa) e o
   **setor indicado**. Atos rotineiros sobre outras IES (autorização de curso,
   CEBAS...) são marcados como "rotina" e ficam ocultos por padrão.
3. **Publicação.** O resultado vai para `docs/dados/`, que o painel lê.

### Quando roda

| Modo | Quando | O que acontece |
|---|---|---|
| **Manual** | Botão "Coletar agora" no painel, ou GitHub › Actions › *Coleta do Radar* › *Run workflow* | Coleta e atualiza o painel (~1 min) |
| **Automático** | Todos os dias, às 4h (Brasília) | Atualiza o painel em silêncio. **Só alerta se surgir item urgente novo** |

Para mudar os horários, edite a linha `cron` em `.github/workflows/coleta.yml` (em UTC: Brasília + 3h).
O painel mostra o novo horário sozinho, a partir da coleta seguinte.
Para desligar a coleta automática, apague o bloco `schedule:`.

### Temas e setor indicado

Cada tema aponta para o(s) setor(es) do CINEA que normalmente cuidariam do
assunto. O painel tem o filtro **Setor do CINEA**, e o CSV exportado traz a
coluna `setores`, o que ajuda no direcionamento das demandas.

| Tema | Setor indicado |
|---|---|
| PUC Minas citada · Regulação · Avaliação de cursos · Fomento e editais | Hub de Integração e Relacionamento |
| EAD e educação digital | Hub + Tecnologias e Experiências de Aprendizagem |
| Currículo e PPC (DCNs, NDE, extensão, carga horária) | Inovação Pedagógica + Hub |
| Formação docente e inovação pedagógica | Inovação Pedagógica e Formação Continuada |
| Tecnologias e dados educacionais (IA, LMS/Canvas, learning analytics) | Tecnologias e Experiências de Aprendizagem |
| Experiência discente (evasão, engajamento, acessibilidade) | Tecnologias + Inovação Pedagógica |

A indicação é uma sugestão automática. O Hub continua responsável por
confirmar o encaminhamento.

### O que é "urgente"

Regras em `[urgencia]` no `config/regras.toml`:

1. Ato oficial (MEC, CNE, INEP, DOU) que **cite a PUC Minas**.
2. **Portaria, resolução, parecer ou decreto sobre EAD/educação digital**,
   exceto atos de rotina.
3. **Mudança estrutural** (marco regulatório, novas DCNs, instrumentos de
   avaliação, regulamento do ENADE, carga horária a distância em cursos
   presenciais, curricularização da extensão...), de qualquer fonte, exceto eventos.
4. **Prazo ou convocação** no título, em tema prioritário, vindo de órgão oficial.

---

## Implantação (uma vez, ~15 minutos)

Pré-requisito: uma conta no GitHub (pode ser institucional ou criada para o setor).

1. **Crie o repositório.** No GitHub: *New repository* › nome
   `boletim-educacao-superior` › **Public**.
   > Hospedar o GitHub Pages de repositório **privado** exige plano pago. O
   > conteúdo do Radar é todo público (notícias e DOU), então um repositório
   > público não expõe nada interno. **Não coloque senhas no código**: use os
   > *Secrets* (passo 4).

2. **Envie os arquivos.** Nesta pasta:
   ```bash
   git init -b main
   git add .
   git commit -m "Radar da Educação Superior"
   git remote add origin https://github.com/SEU-USUARIO/boletim-educacao-superior.git
   git push -u origin main
   ```

3. **Ative o painel.** No repositório: *Settings › Pages › Build and deployment*
   › *Source: Deploy from a branch* › Branch `main`, pasta **`/docs`** › *Save*.
   Em 1 ou 2 minutos o painel estará em
   `https://SEU-USUARIO.github.io/boletim-educacao-superior/`.

4. **Permita que a coleta grave os dados.** *Settings › Actions › General ›
   Workflow permissions* › **Read and write permissions** › *Save*.

5. **Rode a primeira coleta.** *Actions › Coleta do Radar › Run workflow*.

6. **Receba os alertas.** Cada pessoa do HUB clica em **Watch › All Activity**
   no repositório (ou *Custom › Issues*). Quando surgir um urgente, o Radar abre
   uma issue com o rótulo `urgente`, e o GitHub manda e-mail para quem observa.

### E-mail direto (opcional, plano B)

Se preferir que o alerta chegue por e-mail sem passar pelo GitHub, cadastre em
*Settings › Secrets and variables › Actions › New repository secret*:

| Secret | Exemplo |
|---|---|
| `SMTP_HOST` | `smtp.office365.com` ou `smtp.gmail.com` |
| `SMTP_PORTA` | `587` |
| `SMTP_USUARIO` | conta que envia |
| `SMTP_SENHA` | senha de app da conta (nunca a senha pessoal) |
| `SMTP_REMETENTE` | opcional; padrão = `SMTP_USUARIO` |
| `ALERTA_EMAIL_PARA` | `hub@exemplo.br, outra@exemplo.br` |

O servidor SMTP institucional pode exigir liberação da TI. Uma conta Gmail
dedicada com "senha de app" funciona sem custo.

---

## Manutenção do dia a dia

Todas as mudanças comuns são feitas em **dois arquivos de texto** em `config/`,
e podem ser editadas direto no site do GitHub (ícone de lápis):

| Quero... | Onde |
|---|---|
| Incluir ou remover uma instituição | `config/fontes.toml`: copie um bloco `[[google_news]]` |
| Acompanhar um assunto no DOU | `config/fontes.toml`: copie um bloco `[[dou]]` |
| Pausar uma fonte | `ativo = false` no bloco da fonte |
| Ajustar o que é relevante | `config/regras.toml`: termos e pesos de cada `[[tema]]` |
| Mudar o setor indicado de um tema | `config/regras.toml`: campo `setores` do `[[tema]]` |
| Esconder um tipo de assunto | `config/regras.toml`: `[ruido]` (rebaixa) ou `[rotina]` (oculta) |
| Mudar o que gera alerta | `config/regras.toml`: `[urgencia]` |

Mudanças nas regras valem também para o histórico já coletado, na próxima
execução.

**Quando uma fonte quebra.** No rodapé do painel, *Situação das fontes na
última coleta* mostra qual falhou e o erro. A coleta continua com as demais;
a execução só é marcada como falha se **todas** falharem.

### Varredura retroativa (trazer notícias antigas)

A coleta normal olha só os últimos dias. Para buscar um período antigo (por exemplo, desde janeiro):

```bash
python -m radar --desde 2026-01-01
```

O Radar busca período a período no Google Notícias e no DOU, baixa o texto dos atos e reclassifica tudo.
Leva alguns minutos, **não envia alertas** e não marca nada como "novo" para a equipe. Depois, faça o commit
de `docs/dados` e `dados`. O histórico desde `manter_desde` (em `config/fontes.toml`) nunca é apagado.

### Publicar mudanças no painel

Depois de mexer em qualquer arquivo de `docs/` (menos `docs/dados/`), rode antes do commit:

```bash
python ferramentas/versao.py
```

Isso carimba a mesma versão na página e nos scripts. Sem isso, quem abrir o painel logo depois da
publicação pode receber uma mistura de arquivos novos e antigos (o navegador guarda cada um por 10 minutos).

### Rodar no próprio computador

```bash
python -m radar --sem-alerta
python -m http.server 8791 --directory docs
```

Depois, abra http://localhost:8791.

---

## Estrutura

```
config/fontes.toml        fontes monitoradas
config/regras.toml        temas, tipos, ruído, rotina e regras de urgência
radar/fontes.py           coleta (Google Notícias e DOU)
radar/triagem.py          classificação por regras
radar/alertas.py          alertas (issue do GitHub e SMTP)
radar/__main__.py         orquestra uma rodada de coleta
docs/                     painel (index.html, app.js, acesso.js, estilo.css)
acesso/                   servidor de acesso (Apps Script) e seus testes
docs/dados/               itens.json e status.json, gerados pela coleta
.github/workflows/        agendamento no GitHub Actions
```

## Limitações conhecidas

- **Google Notícias** indexa os sites com algum atraso (horas) e pode não pegar
  páginas que não sejam notícias. Os links passam por um redirecionamento do
  Google antes de chegar ao site original.
- **DOU:** a busca devolve no máximo ~20 atos por consulta e período. Para
  temas muito volumosos, use `periodo = "dia"` ou uma consulta mais específica.
- **Triagem por palavras-chave** erra às vezes. Por isso o painel mostra todos
  os itens, não só os urgentes, e as regras são ajustáveis.
- **Lidos e "última visita"** ficam salvos no navegador de cada pessoa, não são
  compartilhados entre a equipe.
- **A tela de entrada não protege os dados:** `docs/dados/itens.json` e o repositório são públicos.
- O GitHub **desativa agendamentos** de repositórios públicos sem atividade por
  60 dias. Os commits da própria coleta costumam bastar; se acontecer, reative
  em *Actions › Coleta do Radar › Enable workflow*.
