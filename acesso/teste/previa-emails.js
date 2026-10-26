// Prévia de todos os e-mails do Boletim, montados pelo próprio Acesso.gs (com o simulador do Google).
// Rodar:  node acesso/teste/previa-emails.js   →  abre acesso/teste/previa-emails.html no navegador.
// Nenhum e-mail é enviado: tudo fica no arquivo.
"use strict";
const fs = require("fs");
const path = require("path");
const { novoAmbiente } = require("./ambiente");

const a = novoAmbiente();
a.g.configurar();
const g = a.g;

const pessoa = { email: "ana.teste@pucminas.br", nome: "Ana Paula Teste", avisos_imediato: "urgente", avisos_semanal: "urgente,alta" };
const itens = [
  { id: "a1", prioridade: "urgente", instituicao: "CNE", data: "2026-10-24", tipo: "Resolução",
    titulo: "Resolução CNE/CES altera as Diretrizes Curriculares Nacionais para cursos de graduação a distância",
    link: "https://www.gov.br/mec/pt-br/cne", motivo_urgencia: "Mudança normativa estrutural",
    resumo: "O Conselho Nacional de Educação publicou resolução que altera a carga horária mínima presencial dos cursos de graduação ofertados a distância, com prazo de adequação dos projetos pedagógicos." },
  { id: "a2", prioridade: "alta", instituicao: "INEP", data: "2026-10-23", tipo: "Comunicado",
    titulo: "Inep divulga cronograma do Enade 2026 e orientações para coordenadores de curso",
    link: "https://www.gov.br/inep", motivo_urgencia: "",
    resumo: "Calendário com prazos de inscrição de estudantes habilitados, preenchimento do questionário do estudante e aplicação da prova." },
  { id: "a3", prioridade: "alta", instituicao: "ABED", data: "2026-10-22", tipo: "Evento",
    titulo: "ABED abre inscrições para o Congresso Internacional de Educação a Distância",
    link: "https://www.abed.org.br", motivo_urgencia: "", resumo: "" },
];

const modelos = [
  ["Código: cadastro novo", "Quem criou a própria conta em \"Criar conta gratuita\".", g.emailCodigo_("cadastro", "Ana Paula Teste", "482915")],
  ["Código: primeiro acesso", "Quem foi cadastrado por um administrador e ainda não criou a senha.", g.emailCodigo_("primeiro", "Ana Paula Teste", "482915")],
  ["Código: esqueci a senha", "Quem já tem senha e pediu para trocar.", g.emailCodigo_("senha", "Ana Paula Teste", "482915")],
  ["Boas-vindas", "Enviado quando um administrador cadastra alguém da equipe (ou em \"Reenviar boas-vindas\").", g.emailBoasVindas_("Ana Paula Teste", "Diego Eduardo", pessoa.email)],
  ["Inscrição nos avisos", "Administrador inscreve alguém que só quer os e-mails (sem boas-vindas), como um gestor.",
    g.emailInscricao_(Object.assign({}, pessoa, { nome: "João Gestor", email: "joao.gestor@pucminas.br" }), "Diego Eduardo")],
  ["Boas-vindas com avisos", "Cadastro com boas-vindas e avisos marcados: um e-mail só.",
    g.emailBoasVindas_("Ana Paula Teste", "Diego Eduardo", pessoa.email, { imediato: ["urgente"], semanal: ["urgente", "alta"] })],
  ["Aviso para quem foi inscrito", "Mesmo aviso; o rodapé diz quem inscreveu a pessoa.",
    g.emailAviso_(Object.assign({}, pessoa, { nome: "João Gestor", avisos_por: "Diego Eduardo" }), "imediato", itens.slice(0, 1), false)],
  ["Aviso na hora (urgente)", "Logo depois da coleta, para quem marcou \"Na hora\". Só as notícias novas.", g.emailAviso_(pessoa, "imediato", itens.slice(0, 1), false)],
  ["Aviso na hora (só alta)", "Mesmo aviso quando não há urgente entre as novidades.", g.emailAviso_(pessoa, "imediato", itens.slice(1, 2), false)],
  ["Resumo semanal", "Segundas, 8h, só para quem teve novidade na semana.", g.emailAviso_(pessoa, "semanal", itens, false)],
  ["Exemplo (Meu perfil)", "\"Enviar um exemplo para mim\": as notícias mais recentes, com a faixa de exemplo.", g.emailAviso_(pessoa, "imediato", itens.slice(0, 2), true)],
];

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prévia dos e-mails</title>
<style>
  body{margin:0;background:#e9ecf1;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#1b2230}
  header{padding:24px 16px 8px;max-width:1100px;margin:0 auto}
  h1{margin:0;font-size:22px} header p{margin:4px 0 0;color:#5b6578}
  nav{max-width:1100px;margin:8px auto 0;padding:0 16px;display:flex;flex-wrap:wrap;gap:6px}
  nav a{background:#fff;border:1px solid #dfe3ea;border-radius:999px;padding:4px 12px;color:#1f4e8c;text-decoration:none;font-size:13px}
  section{max-width:1100px;margin:24px auto;padding:0 16px}
  h2{margin:0;font-size:17px} .quando{margin:2px 0 8px;color:#5b6578;font-size:14px}
  .assunto{background:#fff;border:1px solid #dfe3ea;border-radius:8px 8px 0 0;padding:8px 12px;font-size:14px}
  .assunto b{color:#5b6578;font-weight:600}
  iframe{display:block;width:100%;height:720px;border:1px solid #dfe3ea;border-top:0;background:#f5f6f8}
  details{margin-top:6px} pre{white-space:pre-wrap;background:#fff;border:1px solid #dfe3ea;border-radius:8px;padding:12px;font-size:13px}
</style></head><body>
<header><h1>Prévia dos e-mails do Boletim</h1><p>Gerada a partir do Acesso.gs, com dados de exemplo. Nenhum e-mail foi enviado.</p></header>
<nav>${modelos.map(([n], i) => `<a href="#m${i}">${esc(n)}</a>`).join("")}</nav>
${modelos.map(([nome, quando, e], i) => `<section id="m${i}"><h2>${i + 1}. ${esc(nome)}</h2><p class="quando">${esc(quando)}</p>
<div class="assunto"><b>Assunto:</b> ${esc(e.assunto)}</div>
<iframe title="${esc(nome)}" srcdoc="${esc(e.html)}"></iframe>
<details><summary>Versão em texto puro</summary><pre>${esc(e.texto)}</pre></details></section>`).join("\n")}
</body></html>`;

const saida = path.join(__dirname, "previa-emails.html");
fs.writeFileSync(saida, html, "utf8");
console.log("Prévia gravada em " + saida);
