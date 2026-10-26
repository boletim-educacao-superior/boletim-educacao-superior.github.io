"""Executa uma rodada de coleta: python -m radar [--sem-alerta] [--desde AAAA-MM-DD]

--desde faz a VARREDURA RETROATIVA: busca nas fontes, período a período, desde a data indicada (Google
Notícias e DOU aceitam período). Não envia alertas e não marca nada como "novo" para a equipe.

1. Lê config/fontes.toml e config/regras.toml
2. Coleta todas as fontes ativas (uma falha não interrompe as outras)
3. Junta com o histórico em docs/dados/itens.json, sem duplicar
4. Reclassifica tudo (mudanças nas regras valem para o histórico)
5. Grava itens.json e status.json (lidos pelo painel) e avisos.json (lido pelo servidor dos e-mails)
6. Envia alerta só para itens urgentes que apareceram nesta rodada
"""

import json
import re
import sys
import time
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import alertas
from .fontes import LIMITE_DOU, buscar_dou, buscar_google_news, resumo_dou, texto_integral_dou
from .triagem import Triagem

# Quantos atos novos do DOU têm o texto integral baixado por execução (na varredura, sem limite prático).
MAX_ATOS_DOU = 60
MAX_ATOS_DOU_VARREDURA = 5000
# Google Notícias devolve no máximo ~100 itens por busca: período com 95 ou mais é dividido ao meio.
LIMITE_GOOGLE = 95

RAIZ = Path(__file__).resolve().parent.parent
ARQ_ITENS = RAIZ / "docs" / "dados" / "itens.json"
ARQ_STATUS = RAIZ / "docs" / "dados" / "status.json"
# Só urgente e alta dos últimos dias: o servidor de acesso (Apps Script) lê este arquivo para mandar os avisos por e-mail.
ARQ_AVISOS = RAIZ / "docs" / "dados" / "avisos.json"
DIAS_AVISOS = 35
# Texto integral dos atos do DOU: usado só na triagem, fica fora de docs/ para o painel carregar leve.
ARQ_TEXTOS = RAIZ / "dados" / "textos_dou.json"
ARQ_WORKFLOW = RAIZ / ".github" / "workflows" / "coleta.yml"
FUSO_BRASILIA = -3  # sem horário de verão desde 2019
NOME_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]
ORDEM_PRIORIDADE = {"urgente": 0, "alta": 1, "media": 2, "baixa": 3}


def carregar_toml(nome):
    with open(RAIZ / "config" / nome, "rb") as f:
        return tomllib.load(f)


def coletar(config):
    janela = config["geral"].get("janela_google", "7d")
    tarefas = [
        (f["instituicao"], f"Google Notícias: {f['instituicao']}", lambda f=f: buscar_google_news(f, janela))
        for f in config.get("google_news", []) if f.get("ativo", True)
    ] + [
        ("DOU", f"DOU: {f.get('rotulo', f['consulta'])}", lambda f=f: buscar_dou(f))
        for f in config.get("dou", []) if f.get("ativo", True)
    ]
    itens, relatorio = [], []
    for instituicao, nome, tarefa in tarefas:
        try:
            achados = tarefa()
            itens.extend(achados)
            relatorio.append({"fonte": nome, "instituicao": instituicao, "ok": True, "itens": len(achados)})
            print(f"[ok]   {nome}: {len(achados)} itens")
        except Exception as e:  # noqa: BLE001 - registra e segue
            relatorio.append({"fonte": nome, "instituicao": instituicao, "ok": False, "erro": str(e)[:300]})
            print(f"[erro] {nome}: {e}")
    return itens, relatorio


def periodos(inicio, fim, dias):
    """Divide [inicio, fim] em pedaços de até `dias` dias."""
    atual = inicio
    while atual <= fim:
        ate = min(fim, atual + timedelta(days=dias - 1))
        yield atual, ate
        atual = ate + timedelta(days=1)


def buscar_dividindo(buscar, periodo, limite):
    """Busca no período; se vier no limite da fonte (sinal de que ficou coisa de fora), divide ao meio e repete."""
    achados = buscar(periodo)
    inicio, fim = periodo
    if len(achados) < limite or inicio == fim:
        if len(achados) >= limite:
            print(f"   [aviso] {inicio}: {len(achados)} itens num só dia, pode ter ficado algo de fora")
        return achados
    meio = inicio + (fim - inicio) // 2
    time.sleep(0.3)
    return buscar_dividindo(buscar, (inicio, meio), limite) + buscar_dividindo(buscar, (meio + timedelta(days=1), fim), limite)


def varrer(config, desde):
    """Varredura retroativa: todas as fontes, período a período, desde a data indicada até hoje."""
    hoje = date.today()
    tarefas = [
        (f["instituicao"], f"Google Notícias: {f['instituicao']}",
         lambda per, f=f: buscar_google_news(f, None, per), 15, LIMITE_GOOGLE)
        for f in config.get("google_news", []) if f.get("ativo", True)
    ] + [
        ("DOU", f"DOU: {f.get('rotulo', f['consulta'])}", lambda per, f=f: buscar_dou(f, per), 7, LIMITE_DOU)
        for f in config.get("dou", []) if f.get("ativo", True)
    ]
    itens, relatorio = [], []
    for instituicao, nome, buscar, dias, limite in tarefas:
        total, erros = 0, 0
        for per in periodos(desde, hoje, dias):
            try:
                achados = buscar_dividindo(buscar, per, limite)
                itens.extend(achados)
                total += len(achados)
            except Exception as e:  # noqa: BLE001 - um período com erro não para a varredura
                erros += 1
                print(f"   [erro] {nome} {per[0]}..{per[1]}: {e}")
            time.sleep(0.3)
        relatorio.append({"fonte": nome, "instituicao": instituicao, "ok": erros == 0, "itens": total,
                          **({"erro": f"{erros} período(s) com erro na varredura"} if erros else {})})
        print(f"[{'ok' if not erros else 'parcial'}] {nome}: {total} itens desde {desde}", flush=True)
    return itens, relatorio


def agenda_automatica():
    """Lê o agendamento (linha cron) do workflow e devolve horas e dias em horário de Brasília.

    Assim o painel mostra sempre o horário que está valendo no GitHub, sem um segundo lugar para manter.
    Só entende o formato usado aqui: "MIN HORAS * * DIAS" (horas e dias como lista ou faixa).
    """
    try:
        m = re.search(r'cron:\s*"(\d+) ([\d,]+) \* \* ([\d,\-*]+)"', ARQ_WORKFLOW.read_text(encoding="utf-8"))
    except OSError:
        return None
    if not m:
        return None
    minuto = int(m.group(1))

    def expandir(campo, ate):
        if campo == "*":
            return list(range(ate + 1))
        valores = []
        for parte in campo.split(","):
            a, _, b = parte.partition("-")
            valores += list(range(int(a), int(b or a) + 1))
        return valores

    horas = sorted((h + FUSO_BRASILIA) % 24 for h in expandir(m.group(2), 23))
    dias = sorted(set(expandir(m.group(3), 6)))  # 0 = domingo (no cron, dia em UTC; nossas horas não cruzam a meia-noite)
    if dias == [1, 2, 3, 4, 5]:
        quando = "Dias úteis"
    elif len(dias) == 7:
        quando = "Todos os dias"
    else:
        quando = ", ".join(NOME_DIA[d] for d in dias).capitalize()
    fmt = lambda h: f"{h}h" + (f"{minuto:02d}" if minuto else "")
    lista = [fmt(h) for h in horas]
    texto = lista[0] if len(lista) == 1 else ", ".join(lista[:-1]) + " e " + lista[-1]
    return {"descricao": f"{quando}, às {texto}", "horas": horas, "minuto": minuto, "dias": dias}


def limite_retencao(config):
    """Data mais antiga mantida: a mais antiga entre "manter_desde" e os últimos "dias_retencao" dias."""
    geral = config["geral"]
    por_dias = (date.today() - timedelta(days=geral.get("dias_retencao", 180))).isoformat()
    return min(por_dias, geral.get("manter_desde", por_dias))


def main(argv):
    config = carregar_toml("fontes.toml")
    triagem = Triagem(carregar_toml("regras.toml"))
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hoje = date.today().isoformat()
    desde = argv[argv.index("--desde") + 1] if "--desde" in argv else None
    varredura = desde is not None
    if "--so" in argv:  # ex.: --so DOU, para repetir a varredura só de algumas fontes
        so = set(argv[argv.index("--so") + 1].split(","))
        for chave in ("google_news", "dou"):
            config[chave] = [f for f in config.get(chave, []) if f["instituicao"] in so]

    historico = {}
    if ARQ_ITENS.exists():
        historico = {it["id"]: it for it in json.loads(ARQ_ITENS.read_text(encoding="utf-8"))}
    textos = json.loads(ARQ_TEXTOS.read_text(encoding="utf-8")) if ARQ_TEXTOS.exists() else {}
    for it in historico.values():  # versões antigas guardavam o texto dentro do item
        if it.get("texto"):
            textos.setdefault(it["id"], it.pop("texto"))

    limite = limite_retencao(config)
    if varredura:
        limite = min(limite, desde)
        coletados, relatorio = varrer(config, date.fromisoformat(desde))
    else:
        coletados, relatorio = coletar(config)
    novos, lidos_dou = [], 0
    max_dou = MAX_ATOS_DOU_VARREDURA if varredura else MAX_ATOS_DOU
    for item in coletados:
        if (item.get("data") or hoje) < limite:
            continue  # o Google às vezes devolve notícias antigas
        anterior = historico.get(item["id"])
        if anterior:
            # Mantém a data em que o item foi visto pela primeira vez.
            item["visto_em"] = anterior.get("visto_em", agora)
            item["resumo"] = anterior.get("resumo") or item["resumo"]
        else:
            # Na varredura, "visto em" = a data da notícia: assim ela não aparece como novidade para a equipe.
            item["visto_em"] = f"{item['data']}T12:00:00+00:00" if varredura and item.get("data") else agora
            if not varredura:
                novos.append(item["id"])
            if item["instituicao"] == "DOU" and item["id"] not in textos and lidos_dou < max_dou:
                lidos_dou += 1
                try:
                    textos[item["id"]] = texto_integral_dou(item["link"])
                    item["resumo"] = resumo_dou(textos[item["id"]]) or item["resumo"]
                    time.sleep(0.4)
                except Exception as e:  # noqa: BLE001 - fica só com o resumo
                    print(f"[aviso] texto do DOU indisponível: {item['link']}: {e}")
        historico[item["id"]] = item

    itens = []
    for it in historico.values():
        if (it.get("data") or hoje) < limite:
            continue
        it.pop("texto", None)
        # A triagem lê o texto integral, mas ele não vai para o painel.
        classificado = triagem.classificar(dict(it, texto=textos.get(it["id"], "")))
        classificado.pop("texto", None)
        itens.append(classificado)
    itens.sort(key=lambda it: (it.get("data") or "", -ORDEM_PRIORIDADE[it["prioridade"]]), reverse=True)

    urgentes_novos = [it for it in itens if it["id"] in set(novos) and it["prioridade"] == "urgente"]
    canais = [] if ("--sem-alerta" in argv or varredura) else alertas.enviar(urgentes_novos, hoje)

    ARQ_ITENS.parent.mkdir(parents=True, exist_ok=True)
    # Sem espaços: com o histórico desde janeiro, o arquivo que o painel baixa fica bem menor.
    ARQ_ITENS.write_text(json.dumps(itens, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ARQ_TEXTOS.parent.mkdir(parents=True, exist_ok=True)
    ids = {it["id"] for it in itens}
    ARQ_TEXTOS.write_text(json.dumps({k: v for k, v in textos.items() if k in ids}, ensure_ascii=False), encoding="utf-8")
    desde_avisos = (datetime.now(timezone.utc) - timedelta(days=DIAS_AVISOS)).isoformat(timespec="seconds")
    ARQ_AVISOS.write_text(json.dumps({
        "gerado_em": agora,
        "itens": [
            {k: it.get(k) for k in ("id", "instituicao", "titulo", "link", "data", "visto_em", "prioridade", "tipo", "motivo_urgencia")}
            | {"resumo": (it.get("resumo") or "")[:400]}
            for it in itens if it["prioridade"] in ("urgente", "alta") and (it.get("visto_em") or "") >= desde_avisos
        ],
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ARQ_STATUS.write_text(json.dumps({
        "ultima_execucao": agora,
        "novos_nesta_execucao": len(novos),
        "urgentes_novos": len(urgentes_novos),
        "alertas_enviados_por": canais,
        "total_no_painel": len(itens),
        "agenda": agenda_automatica(),
        "fontes": relatorio,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{len(novos)} novos · {len(urgentes_novos)} urgentes novos · {len(itens)} no painel"
          + (f" · alerta via {', '.join(canais)}" if canais else ""))
    # Falha a execução só se TODAS as fontes falharem (algo está errado de verdade).
    return 1 if relatorio and not any(r["ok"] for r in relatorio) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
