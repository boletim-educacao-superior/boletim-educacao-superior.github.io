"""Alertas para itens urgentes novos.

Dois canais, ambos gratuitos e opcionais:
  1. Issue no GitHub (padrão quando roda no GitHub Actions). Quem "observa"
     o repositório recebe e-mail automaticamente — sem configurar SMTP.
  2. E-mail via SMTP, se as variáveis SMTP_* estiverem definidas.
"""

import json
import os
import smtplib
import urllib.request
from email.message import EmailMessage


def _corpo(urgentes, url_painel):
    linhas = [f"O Radar encontrou {len(urgentes)} item(ns) urgente(s):", ""]
    for it in urgentes:
        linhas.append(f"- [{it['instituicao']}] {it['titulo']}")
        linhas.append(f"  Motivo: {it['motivo_urgencia']} · Data: {it['data']}")
        linhas.append(f"  {it['link']}")
        linhas.append("")
    if url_painel:
        linhas.append(f"Painel: {url_painel}")
    return "\n".join(linhas)


def alertar_github(urgentes, assunto, url_painel):
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not (token and repo) or os.environ.get("ALERTA_GITHUB", "1") == "0":
        return False
    corpo = _corpo(urgentes, url_painel)
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues",
        data=json.dumps({"title": assunto, "body": corpo, "labels": ["urgente"]}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "radar-educacao-superior",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30):
        return True


def alertar_email(urgentes, assunto, url_painel):
    host = os.environ.get("SMTP_HOST")
    destino = os.environ.get("ALERTA_EMAIL_PARA")
    if not (host and destino):
        return False
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = os.environ.get("SMTP_REMETENTE") or os.environ.get("SMTP_USUARIO", "")
    msg["To"] = destino
    msg.set_content(_corpo(urgentes, url_painel))
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORTA", "587")), timeout=30) as smtp:
        smtp.starttls()
        if os.environ.get("SMTP_USUARIO"):
            smtp.login(os.environ["SMTP_USUARIO"], os.environ.get("SMTP_SENHA", ""))
        smtp.send_message(msg)
    return True


def enviar(urgentes, hoje):
    if not urgentes:
        return []
    assunto = f"Radar Educação Superior: {len(urgentes)} item(ns) urgente(s) em {hoje}"
    url_painel = os.environ.get("URL_PAINEL", "")
    enviados = []
    for nome, func in (("github", alertar_github), ("email", alertar_email)):
        try:
            if func(urgentes, assunto, url_painel):
                enviados.append(nome)
        except Exception as e:  # noqa: BLE001 - alerta nunca derruba a coleta
            print(f"[alerta] falha no canal {nome}: {e}")
    return enviados
