"""Classificação por palavras-chave (regras em config/regras.toml)."""

import re

from .fontes import normalizar


def _compilar(termos):
    """Uma regex por lista, casando palavras inteiras (evita 'ead' em 'leader').

    Termo terminado em "*" casa como prefixo: "credenciad*" pega
    credenciado, credenciada, credenciados...
    """
    partes = []
    for t in termos:
        if t.strip().endswith("*"):
            partes.append(re.escape(normalizar(t.strip()[:-1])))
        elif t.strip():
            partes.append(re.escape(normalizar(t)) + r"(?![a-z0-9])")
    if not partes:
        return None
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(partes) + ")")


def _palavra(regex, texto):
    return regex is not None and regex.search(texto) is not None


class Triagem:
    def __init__(self, regras):
        self.limiar_alta = regras["prioridade"]["limiar_alta"]
        self.limiar_media = regras["prioridade"]["limiar_media"]
        self.temas = [(t["nome"], t["peso"], _compilar(t["termos"])) for t in regras.get("tema", [])]
        self.setores_por_tema = {t["nome"]: t.get("setores", []) for t in regras.get("tema", [])}
        self.tipos = [(t["nome"], _compilar(t["termos"])) for t in regras.get("tipo", [])]
        self.peso_ruido = regras.get("ruido", {}).get("peso", 0)
        self.re_ruido = _compilar(regras.get("ruido", {}).get("termos", []))
        self.peso_rotina = regras.get("rotina", {}).get("peso", 0)
        self.re_rotina = _compilar(regras.get("rotina", {}).get("termos", []))
        u = regras.get("urgencia", {})
        self.re_instituicao = _compilar(u.get("termos_instituicao", []))
        self.re_orgaos = _compilar(u.get("orgaos_oficiais", []))
        self.tipos_normativos = set(u.get("tipos_normativos", []))
        self.temas_urgentes = set(u.get("temas_urgentes", []))
        self.re_criticos = _compilar(u.get("termos_criticos", []))
        self.temas_prioritarios = set(u.get("temas_prioritarios", []))
        self.re_prazo = _compilar(u.get("termos_prazo", []))
        self.inst_oficiais = set(u.get("instituicoes_oficiais", []))
        self.re_internos = _compilar(u.get("orgaos_internos", []))
        self.re_normativos = _compilar(u.get("orgaos_normativos", []))
        desconhecidos = (self.temas_urgentes | self.temas_prioritarios) - set(self.setores_por_tema)
        if desconhecidos:
            raise ValueError(f"regras.toml [urgencia] cita tema(s) inexistente(s): {sorted(desconhecidos)}")

    def classificar(self, item):
        titulo = normalizar(item["titulo"])
        texto = " ".join(normalizar(item.get(c, "")) for c in ("titulo", "resumo", "texto"))
        orgao = normalizar(item.get("orgao", ""))

        temas, pontos = [], 0
        for nome, peso, regex in self.temas:
            if _palavra(regex, texto):
                temas.append(nome)
                pontos += peso

        tipo = "Notícia"
        for nome, regex in self.tipos:
            if _palavra(regex, titulo):
                tipo = nome
                break

        ruido = _palavra(self.re_ruido, texto)
        if ruido:
            pontos -= self.peso_ruido
        rotina = _palavra(self.re_rotina, texto)
        if rotina:
            pontos -= self.peso_rotina

        cita_puc = _palavra(self.re_instituicao, texto)
        # Ato interno de outra instituição (pela unidade no DOU ou pelo título): não é norma para a PUC Minas.
        interno = item["instituicao"] == "DOU" and _palavra(self.re_internos, orgao.split("/", 1)[-1] + " " + titulo)
        oficial = item["instituicao"] in self.inst_oficiais and not interno
        # No DOU, a norma precisa vir do MEC, da Presidência ou de conselho profissional (não de outro ministério).
        orgao_normativo = item["instituicao"] != "DOU" or (
            self.re_normativos is None or _palavra(self.re_normativos, orgao.split("/", 1)[0]))
        motivo = ""
        if cita_puc and _palavra(self.re_orgaos, orgao + " " + texto) and oficial and not ruido:
            motivo = "Ato oficial que cita a PUC Minas"
        elif tipo in self.tipos_normativos and self.temas_urgentes.intersection(temas) and not rotina and not interno and orgao_normativo:
            motivo = f"{tipo} sobre {', '.join(sorted(self.temas_urgentes.intersection(temas)))}"
        elif _palavra(self.re_criticos, texto) and not rotina and tipo != "Evento":
            motivo = "Mudança normativa estrutural"
        elif (oficial and not rotina and self.temas_prioritarios.intersection(temas)
              and _palavra(self.re_prazo, titulo)):
            motivo = "Prazo ou convocação em tema prioritário"

        if motivo:
            prioridade = "urgente"
        elif pontos >= self.limiar_alta:
            prioridade = "alta"
        elif pontos >= self.limiar_media:
            prioridade = "media"
        else:
            prioridade = "baixa"

        setores = []
        for tema in temas:
            setores += [s for s in self.setores_por_tema[tema] if s not in setores]

        item.update({
            "temas": temas,
            "setores": setores,
            "tipo": tipo,
            "pontos": pontos,
            "prioridade": prioridade,
            "motivo_urgencia": motivo,
            "rotina": rotina,
        })
        return item
