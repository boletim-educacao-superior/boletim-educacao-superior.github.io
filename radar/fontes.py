"""Coleta de itens nas fontes configuradas em config/fontes.toml.

Cada função devolve uma lista de dicionários no formato padrão:
    {id, instituicao, fonte, titulo, resumo, link, data, orgao}
onde "data" é uma string ISO (AAAA-MM-DD).
"""

import hashlib
import html
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 RadarEducacaoSuperior/1.0"
)


def baixar(url, tentativas=3, timeout=40):
    """GET com algumas tentativas; devolve o corpo como texto UTF-8."""
    erro = None
    for n in range(tentativas):
        try:
            # O DOU recusa (403) requisições sem o cabeçalho Accept.
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001 - qualquer falha de rede conta
            erro = e
            time.sleep(2 * (n + 1))
    raise RuntimeError(f"falha ao baixar {url}: {erro}")


def normalizar(texto):
    """Minúsculas, sem acento e com espaços simples — usado em comparações."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem_acento.lower()).strip()


def limpar_html(texto):
    texto = re.sub(r"<[^>]+>", " ", texto or "")
    return re.sub(r"\s+", " ", html.unescape(texto)).strip()


def gerar_id(*partes):
    return hashlib.sha1("|".join(partes).encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------ Google News --

def buscar_google_news(fonte, janela, periodo=None):
    """janela = últimos dias ("7d"); periodo = (inicio, fim) em date, para a varredura retroativa."""
    if periodo:
        # before é exclusivo: soma um dia para incluir o último dia do período.
        consulta = f"{fonte['consulta']} after:{periodo[0].isoformat()} before:{(periodo[1] + timedelta(days=1)).isoformat()}"
    else:
        consulta = f"{fonte['consulta']} when:{janela}"
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": consulta, "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"}
    )
    raiz = ET.fromstring(baixar(url))
    itens = []
    for item in raiz.iter("item"):
        titulo = item.findtext("title", "")
        origem = item.find("source")
        nome_origem = origem.text if origem is not None else ""
        # O Google acrescenta " - Nome do site" ao título; removemos.
        if nome_origem and titulo.endswith(" - " + nome_origem):
            titulo = titulo[: -len(" - " + nome_origem)]
        titulo = re.sub(r"\s+[—–-]\s+(Minist[ée]rio da Educa[çc][ãa]o|Governo Federal|www\.gov\.br)$", "", titulo).strip()
        try:
            data = parsedate_to_datetime(item.findtext("pubDate", "")).date().isoformat()
        except (TypeError, ValueError):
            data = ""
        itens.append({
            "id": gerar_id(fonte["instituicao"], normalizar(titulo)),
            "instituicao": fonte["instituicao"],
            "fonte": "Google Notícias",
            "titulo": titulo,
            "resumo": "",
            "link": item.findtext("link", ""),
            "data": data,
            "orgao": nome_origem,
        })
    return itens


# ------------------------------------------------- Diário Oficial da União --

RE_PARAMS_DOU = re.compile(
    r'<script[^>]*id="[^"]*BuscaDouPortlet_params"[^>]*>(.*?)</script>', re.S
)


# A busca do DOU devolve no máximo 20 atos e não pagina: quem quiser mais precisa de períodos menores.
LIMITE_DOU = 20


def buscar_dou(fonte, periodo=None):
    """periodo = (inicio, fim) em date, para a varredura retroativa; sem ele, usa o "periodo" da fonte."""
    parametros = {"q": fonte["consulta"], "s": fonte.get("secao", "todos"), "sortType": "1"}  # 1 = mais recentes primeiro
    if periodo:
        parametros.update({"exactDate": "personalizado",
                           "publishFrom": periodo[0].strftime("%d-%m-%Y"), "publishTo": periodo[1].strftime("%d-%m-%Y")})
    else:
        parametros["exactDate"] = fonte.get("periodo", "semana")
    url = "https://www.in.gov.br/consulta/-/buscar/dou?" + urllib.parse.urlencode(parametros)
    pagina = baixar(url)
    m = RE_PARAMS_DOU.search(pagina)
    if not m:
        raise RuntimeError("estrutura da página do DOU mudou (bloco de dados não encontrado)")
    itens = []
    for ato in json.loads(m.group(1)).get("jsonArray", []):
        dia, mes, ano = ato["pubDate"].split("/")
        link = "https://www.in.gov.br/web/dou/-/" + ato["urlTitle"]
        secao = ato.get("pubName", "").replace("DO", "Seção ")
        itens.append({
            "id": gerar_id(link),
            "instituicao": "DOU",
            "fonte": f"DOU · {fonte.get('rotulo', '')} · {secao}".strip(" ·"),
            "titulo": limpar_html(ato.get("title", "")),
            "resumo": limpar_html(ato.get("content", ""))[:600],
            "link": link,
            "data": f"{ano}-{mes}-{dia}",
            "orgao": ato.get("hierarchyStr", ""),
        })
    return itens


RE_TEXTO_DOU = re.compile(r'<div class="texto-dou">(.*?)</div>\s*</div>', re.S)


def texto_integral_dou(link, limite=2500):
    """Texto do ato (o resumo da busca é curto demais para a triagem)."""
    m = RE_TEXTO_DOU.search(baixar(link, tentativas=2))
    return limpar_html(m.group(1))[:limite] if m else ""


def resumo_dou(texto, tamanho=400):
    """Trecho que diz do que o ato trata: o "Assunto:" ou o que vem após "resolve:"."""
    for marcador in ("Assunto:", "resolve:", "RESOLVE:", "Objeto:"):
        i = texto.find(marcador)
        if i >= 0:
            return texto[i + len(marcador):].strip()[:tamanho]
    return ""
