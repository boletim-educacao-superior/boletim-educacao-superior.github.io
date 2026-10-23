"""Carimba a versão do painel antes de publicar: python ferramentas/versao.py

O GitHub Pages deixa cada arquivo guardado no navegador por 10 minutos, e cada um por conta própria.
Logo depois de uma publicação, o navegador pode juntar o index.html novo com um acesso.js ou app.js
antigo (ou o contrário) e a tela quebra. Por isso:
  - o index.html pede os arquivos com ?v=CARIMBO (URL nova = arquivo novo);
  - index.html, acesso.js e app.js levam o mesmo CARIMBO; se não baterem, o painel recarrega
    sozinho uma vez, buscando tudo de novo (ver docs/acesso.js, conferirVersao).
Rode sempre que mudar algo em docs/ (menos docs/dados, que é da coleta).
"""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
carimbo = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

regras = {
    "index.html": [
        (r'(href="estilo\.css)(\?v=\w+)?(")', rf"\g<1>?v={carimbo}\g<3>"),
        (r'(src="acesso\.js)(\?v=\w+)?(")', rf"\g<1>?v={carimbo}\g<3>"),
        (r'(src="app\.js)(\?v=\w+)?(")', rf"\g<1>?v={carimbo}\g<3>"),
        (r'(window\.RADAR_VERSAO = ")\w*(")', rf"\g<1>{carimbo}\g<2>"),
    ],
    "acesso.js": [(r'(const VERSAO_ACESSO = ")\w*(")', rf"\g<1>{carimbo}\g<2>")],
    "app.js": [(r'(const VERSAO_APP = ")\w*(")', rf"\g<1>{carimbo}\g<2>")],
}
for nome, trocas in regras.items():
    caminho = DOCS / nome
    texto = caminho.read_text(encoding="utf-8")
    for padrao, novo in trocas:
        texto, n = re.subn(padrao, novo, texto)
        if n != 1:
            sys.exit(f"{nome}: esperava 1 ocorrência de {padrao}, achei {n}")
    caminho.write_text(texto, encoding="utf-8", newline="\n")
print(f"Versão do painel: {carimbo}")
