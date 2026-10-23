"""Executa uma rodada de coleta: python -m radar [--sem-alerta]

1. Lê config/fontes.toml e config/regras.toml
2. Coleta todas as fontes ativas (uma falha não interrompe as outras)
3. Junta com o histórico em docs/dados/itens.json, sem duplicar
4. Reclassifica tudo (mudanças nas regras valem para o histórico)
5. Grava itens.json e status.json (lidos pelo painel)
6. Envia alerta só para itens urgentes que apareceram nesta rodada
"""

import json
import sys
import time
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import alertas
from .fontes import buscar_dou, buscar_google_news, resumo_dou, texto_integral_dou
from .triagem import Triagem

# Quantos atos novos do DOU têm o texto integral baixado por execução.
MAX_ATOS_DOU = 60

RAIZ = Path(__file__).resolve().parent.parent
ARQ_ITENS = RAIZ / "docs" / "dados" / "itens.json"
ARQ_STATUS = RAIZ / "docs" / "dados" / "status.json"
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


def main(argv):
    config = carregar_toml("fontes.toml")
    triagem = Triagem(carregar_toml("regras.toml"))
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hoje = date.today().isoformat()

    historico = {}
    if ARQ_ITENS.exists():
        historico = {it["id"]: it for it in json.loads(ARQ_ITENS.read_text(encoding="utf-8"))}

    limite = (date.today() - timedelta(days=config["geral"].get("dias_retencao", 180))).isoformat()
    coletados, relatorio = coletar(config)
    novos, lidos_dou = [], 0
    for item in coletados:
        if (item.get("data") or hoje) < limite:
            continue  # o Google às vezes devolve notícias antigas
        anterior = historico.get(item["id"])
        if anterior:
            # Mantém a data em que o item foi visto pela primeira vez.
            item["visto_em"] = anterior.get("visto_em", agora)
            item["texto"] = anterior.get("texto", "")
            item["resumo"] = anterior.get("resumo") or item["resumo"]
        else:
            item["visto_em"] = agora
            novos.append(item["id"])
            if item["instituicao"] == "DOU" and lidos_dou < MAX_ATOS_DOU:
                lidos_dou += 1
                try:
                    item["texto"] = texto_integral_dou(item["link"])
                    item["resumo"] = resumo_dou(item["texto"]) or item["resumo"]
                    time.sleep(0.5)
                except Exception as e:  # noqa: BLE001 - fica só com o resumo
                    print(f"[aviso] texto do DOU indisponível: {item['link']}: {e}")
        historico[item["id"]] = item

    itens = [triagem.classificar(it) for it in historico.values() if (it.get("data") or hoje) >= limite]
    itens.sort(key=lambda it: (it.get("data") or "", -ORDEM_PRIORIDADE[it["prioridade"]]), reverse=True)

    urgentes_novos = [it for it in itens if it["id"] in set(novos) and it["prioridade"] == "urgente"]
    canais = [] if "--sem-alerta" in argv else alertas.enviar(urgentes_novos, hoje)

    ARQ_ITENS.parent.mkdir(parents=True, exist_ok=True)
    ARQ_ITENS.write_text(json.dumps(itens, ensure_ascii=False, indent=1), encoding="utf-8")
    ARQ_STATUS.write_text(json.dumps({
        "ultima_execucao": agora,
        "novos_nesta_execucao": len(novos),
        "urgentes_novos": len(urgentes_novos),
        "alertas_enviados_por": canais,
        "total_no_painel": len(itens),
        "fontes": relatorio,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{len(novos)} novos · {len(urgentes_novos)} urgentes novos · {len(itens)} no painel"
          + (f" · alerta via {', '.join(canais)}" if canais else ""))
    # Falha a execução só se TODAS as fontes falharem (algo está errado de verdade).
    return 1 if relatorio and not any(r["ok"] for r in relatorio) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
