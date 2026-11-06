"""SQL aggregates only. One disclosure policy for every public analytical route.

Filters form a fixed partition, including the unpublished remainder. Distributions
use one global category plan; if it is unsafe in any partition, only the unfiltered
distribution is released. Cross tables are withheld in full, never cell by cell.
"""
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Answer, Question, Questionnaire, SurveyResponse
from .questionnaires import DEMO_NOTICE, DEMO_VERSION, load_definition

POOL = "Otras categorías · agrupadas por privacidad"
PROTECTED = "Valores reservados por privacidad. Los recuentos, márgenes o filtros relacionados podrían revelar grupos pequeños."
COVERAGE_PROTECTED = "La cobertura conjunta difiere de la cobertura de alguna pregunta. El cruce se reserva porque restar sus márgenes podría revelar respuestas faltantes en un grupo pequeño."
METHOD = "Análisis descriptivo de respuestas declaradas; no es un modelo predictivo."
TITLES = {
    "dropout_thoughts": "Pensamientos de abandono",
    "motivation": "Motivación académica declarada",
    "main_difficulty": "Principales dificultades de continuidad",
    "university": "Universidades representadas",
    "semester": "Semestre actual",
    "economic_difficulty": "Dificultad económica",
    "academic_load": "Carga académica percibida",
    "institutional_support": "Apoyo académico institucional",
    "absence_frequency": "Frecuencia de ausencias",
    "work_hours": "Horas semanales de trabajo remunerado",
    "enrollment_likelihood": "Próxima matrícula declarada",
    "failed_courses": "Asignaturas reprobadas",
    "gpa_range": "Rango de promedio académico",
}
CHARTS = {key: TITLES[key] for key in ("dropout_thoughts", "motivation", "main_difficulty", "university", "semester")}
MOBILITY_TITLES = {
    "transport_mode": "Medio de transporte habitual",
    "commute_time": "Tiempo de desplazamiento",
    "weekly_transport_cost": "Costo semanal de transporte",
    "mobility_delay": "Frecuencia de retrasos",
    "commute_difficulty": "Dificultad para llegar a la universidad",
}
TITLES.update(MOBILITY_TITLES)
ORDINAL = set(TITLES) - {"university", "main_difficulty", "transport_mode"}
PAIRS = ["motivation", "economic_difficulty", "academic_load", "institutional_support", "absence_frequency", "work_hours", "semester"]
RULES = {
    "economic_difficulty": ("Dificultad económica elevada", ["4 - Bastante dificultad", "5 - Mucha dificultad"]),
    "dropout_thoughts": ("Pensamientos frecuentes de abandono", ["Frecuentemente", "Muy frecuentemente"]),
    "academic_load": ("Dificultad elevada con la carga académica", ["4 - Bastante difícil", "5 - Muy difícil"]),
}
# Explicit coarsening of the original instrument, never inferred from numeric
# midpoints or invented observations. One mapping per variable across modules.
COARSENING = {
    "dropout_thoughts": {"Nunca": ["Nunca"], "Ha pensado en abandonar alguna vez": ["Rara vez", "Algunas veces", "Frecuentemente", "Muy frecuentemente"]},
    "motivation": {"Poco o moderadamente motivado": ["2 - Poco motivado", "3 - Moderadamente motivado"], "Bastante o muy motivado": ["4 - Bastante motivado", "5 - Muy motivado"]},
    "economic_difficulty": {"Ninguna o poca dificultad": ["1 - Ninguna dificultad", "2 - Poca dificultad"], "Dificultad moderada o mayor": ["3 - Dificultad moderada", "4 - Bastante dificultad", "5 - Mucha dificultad"]},
    "academic_load": {"Nada o poco difícil": ["1 - Nada difícil", "2 - Poco difícil"], "Moderadamente difícil o más": ["3 - Moderadamente difícil", "4 - Bastante difícil", "5 - Muy difícil"]},
    "institutional_support": {"Apoyo nulo, poco o moderado": ["1 - Ningún apoyo", "2 - Poco apoyo", "3 - Apoyo moderado"], "Bastante o mucho apoyo": ["4 - Bastante apoyo", "5 - Mucho apoyo"]},
    "absence_frequency": {"Ninguna o una ausencia": ["Nunca", "Una vez"], "Dos o más ausencias": ["Dos o tres veces", "Cuatro o más veces"]},
    "work_hours": {"No trabaja": ["No trabajo"], "Trabajo remunerado": ["De 1 a 20 horas", "De 21 a 40 horas", "Más de 40 horas"]},
    "commute_time": {"Hasta 30 minutos": ["Hasta 15 minutos", "16 a 30 minutos"], "Más de 30 minutos": ["31 a 60 minutos", "Más de 60 minutos"]},
}
FLOW_GROUPS = {
    "transport_mode": {
        "Transporte público": ["Transporte público"],
        "Otros medios": ["A pie", "Bicicleta", "Motocicleta", "Automóvil"],
    },
    "commute_time": COARSENING["commute_time"],
}


@lru_cache
def reference(version="forms-v1"):
    path = Path(__file__).resolve().parents[1] / "configuration" / f"{version}.json"
    return {q.key: q for q in load_definition(path).questions}


def analytical_question(key):
    if key in MOBILITY_TITLES or (key == "university" and get_settings().data_mode == "demo"):
        return reference(DEMO_VERSION)[key]
    return reference()[key]


def compatible_questions(db):
    """No cross-version equivalence by key alone; explicit mapping AND signature."""
    result = {key: [] for key in TITLES}
    demo = get_settings().data_mode == "demo"
    for q, version, provenance in db.execute(select(Question, Questionnaire.version, Questionnaire.provenance).join(Questionnaire)):
        if q.key not in TITLES or (not demo and (version == DEMO_VERSION or provenance.get("data_mode") == "demo")):
            continue
        versions = []
        if q.key in reference():
            versions.append("forms-v1")
        if demo and (q.key in MOBILITY_TITLES or q.key == "university"):
            versions.append(DEMO_VERSION)
        for canonical in versions:
            declared = version == canonical or provenance.get("analytics_compatibility", {}).get(q.key) == f"{canonical}:{q.key}"
            ref = reference(canonical)[q.key]
            if declared and q.kind == ref.kind and q.prompt == ref.prompt and [o.value for o in q.options] == ref.options:
                result[q.key].append(q.id)
                break
    return result


def safe_categories(rows, minimum):
    visible = [(label, n) for label, n in rows if not small(n, minimum)]
    hidden = [(label, n) for label, n in rows if small(n, minimum)]
    if hidden:
        # Equal hidden counts can be inferred (e.g. two 1s, or two 4s at k=5).
        # Hide the smallest positive public frequency when needed, including
        # ties so exchanging hidden labels leaves the public result unchanged.
        if sum(n for _, n in hidden) < minimum or len({n for _, n in hidden}) < 2:
            secondary = min((n for _, n in visible if n), default=None)
            if secondary is None:
                return [], True
            hidden.extend((label, n) for label, n in visible if n == secondary)
            visible = [(label, n) for label, n in visible if n != secondary]
        if sum(n for _, n in hidden) < minimum:
            return [], True
        visible.append((POOL, sum(n for _, n in hidden)))
    return visible, bool(hidden)


def small(n, minimum):
    return 0 < n < minimum


FILTER_KEYS = ("university", "semester")


def atomic_counts(db, ids, keys=()):
    """SQL counts by filter atom and requested categories, including filter gaps."""
    columns = {}
    query = select(SurveyResponse.id).select_from(SurveyResponse).join(Questionnaire)
    if get_settings().data_mode == "demo":
        query = query.where(Questionnaire.version == DEMO_VERSION)
    else:
        query = query.where(Questionnaire.version != DEMO_VERSION,
                            func.coalesce(Questionnaire.provenance["data_mode"].as_string(), "real") != "demo")
    for key in dict.fromkeys((*FILTER_KEYS, *keys)):
        values = select(Answer.response_id, Answer.value).where(Answer.question_id.in_(ids[key])).subquery()
        query = query.join(values, values.c.response_id == SurveyResponse.id, isouter=key in FILTER_KEYS)
        columns[key] = values.c.value
        if key in keys and key in FILTER_KEYS:
            query = query.where(values.c.value.is_not(None))
    dimensions = [columns[key] for key in (*FILTER_KEYS, *keys)]
    return db.execute(query.with_only_columns(*dimensions, func.count()).group_by(*columns.values())).all()


@dataclass
class Frequencies:
    full: Counter
    selected: Counter
    partitions: dict


@dataclass
class Context:
    db: Session
    university: str | None = None
    semester: str | None = None

    def __post_init__(self):
        self.minimum = get_settings().min_group_size
        self.ids = compatible_questions(self.db)
        atoms = atomic_counts(self.db, self.ids)
        self.global_total = sum(n for _, _, n in atoms)
        self.total = sum(n for u, s, n in atoms if self.matches(u, s))
        self.allowed = {}
        for index, key in enumerate(FILTER_KEYS):
            rows = Counter()
            for atom in atoms:
                if atom[index] is not None:
                    rows[atom[index]] += atom[-1]
            protected, _ = safe_categories(rows.items(), self.minimum)
            # Filter totals are themselves a public release. A selectable label
            # must NEVER unpool a secondary-suppressed category (e.g. 12 - 8 = 4).
            visible = {label for label, _ in protected if label != POOL}
            self.allowed[key] = sorted(label for label, n in rows.items() if label in visible
                                       and n >= self.minimum and not small(self.global_total - n, self.minimum))
        # Coarsen the public filter partition until every residual/intersection
        # contains zero or >=k people. Removing labels is deterministic.
        while True:
            cells = Counter()
            for u, s, n in atoms:
                cells[self.partition(u, s)] += n
            unsafe = [cell for cell, n in cells.items() if small(n, self.minimum)]
            if not unsafe:
                break
            candidates = [(key, label) for cell in unsafe for key, label in zip(("university", "semester"), cell) if label is not None]
            if not candidates:
                candidates = [(key, label) for key in self.allowed for label in self.allowed[key]]
            if not candidates:
                break
            key, label = sorted(set(candidates))[0]
            self.allowed[key].remove(label)
        self.partition_totals = cells
        for key, value in (("university", self.university), ("semester", self.semester)):
            if value is not None and value not in self.allowed[key]:
                raise ValueError("El filtro no está disponible: se protege su grupo, complemento o intersección. Restablece los filtros.")
        self.filtered = self.university is not None or self.semester is not None
        self._frequencies = {}

    def partition(self, university, semester):
        return (university if university in self.allowed["university"] else None,
                semester if semester in self.allowed["semester"] else None)

    def matches(self, university, semester):
        return ((self.university is None or self.university == university)
                and (self.semester is None or self.semester == semester))

    def frequencies(self, *keys):
        if keys not in self._frequencies:
            result = Frequencies(Counter(), Counter(), {cell: Counter() for cell in self.partition_totals})
            for university, semester, *values, n in atomic_counts(self.db, self.ids, keys):
                value = values[0] if len(keys) == 1 else tuple(values)
                result.full[value] += n
                result.partitions[self.partition(university, semester)][value] += n
                if self.matches(university, semester):
                    result.selected[value] += n
            self._frequencies[keys] = result
        return self._frequencies[keys]

    def base(self):
        status = "empty" if self.total == 0 else "insufficient" if self.total < self.minimum or small(self.global_total - self.total, self.minimum) else "ready"
        institutions = self.frequencies("university").selected if status == "ready" else Counter()
        published, pooled = safe_categories(self.frequencies("university").full.items(), self.minimum) if institutions else ([], False)
        public_institutions = {label for label, _ in published if label != POOL}
        # The number of labels can disclose that every category in a reserve is occupied.
        university_total = len(institutions) if institutions and (not pooled or institutions.keys() <= public_institutions) else None
        demo = get_settings().data_mode == "demo"
        return {"status": status, "data_mode": "demo" if demo else "real", "minimum_group_size": self.minimum,
                **({"data_notice": DEMO_NOTICE} if demo else {}),
                "filters": self.allowed, "selected": {"university": self.university, "semester": self.semester},
                "eligible_responses": self.total if status != "insufficient" else None,
                "universities": university_total,
                "method": "Análisis descriptivo de registros sintéticos. Las diferencias se limitan a esta simulación." if demo else METHOD,
                "charts": [],
                "message": "No hay respuestas elegibles para esta selección." if status == "empty" else PROTECTED if status == "insufficient" else None,
                "filter_note": "Solo se ofrecen grupos compatibles cuyo conjunto de intersecciones y complementos es publicable. Algunas distribuciones se reservan al conjunto completo."}


def specification(key, title, required, kind="distribution"):
    return {"key": key, "title": title, "kind": kind, "required_variables": required,
            "variable_types": {k: "ordinal" if k in ORDINAL else "categorical" for k in required},
            "indicator": {"distribution": "Frecuencia y porcentaje de categorías",
                          "matrix": "Frecuencias conjuntas y porcentajes por fila",
                          "rates": "Frecuencia y proporción por universidad"}[kind],
            "compatible_filters": ["university", "semester"], "privacy": "fixed_partition_k5_complementary",
            "minimum_group_size": get_settings().min_group_size, "minimum_conditions": "Cobertura y celdas publicables; compatibilidad explícita del instrumento",
            "definition": " / ".join(analytical_question(key).prompt for key in required),
            "category_catalog": {k: analytical_question(k).options for k in required},
            "status": "insufficient", "denominator": None, "missing": None, "coverage_percentage": None,
            "pooled": False, "message": PROTECTED, "data": [], "rows": [], "columns": [], "filterable": False}


def distribution(ctx, key):
    options = analytical_question(key).options
    result = {**specification(key, TITLES[key], [key]), "ordered_categories": options}
    if not ctx.ids[key]:
        return {**result, "status": "unavailable", "message": "Variable ausente o sin regla explícita de compatibilidad con el instrumento analítico."}
    if ctx.total == 0:
        return {**result, "status": "unavailable", "message": "Aún no hay respuestas en esta selección."}
    if ctx.total < ctx.minimum:
        return {**result, "message": f"Se requieren al menos {ctx.minimum} respuestas para divulgar frecuencias."}
    frequencies = ctx.frequencies(key)
    global_rows = frequencies.full.items()
    if not global_rows:
        return {**result, "status": "unavailable", "message": "Todavía no se han recopilado valores compatibles para esta variable."}
    protected, pooled = safe_categories(global_rows, ctx.minimum)
    global_valid = sum(n for _, n in global_rows)
    if global_valid < ctx.minimum or small(ctx.global_total - global_valid, ctx.minimum):
        return result
    visible = {label for label, _ in protected if label != POOL}
    if not visible:
        return {**result, "message": "Publicar alguna categoría permitiría reconstruir un recuento pequeño. Se conserva el catálogo sin frecuencias."}

    def prepare(rows, total):
        valid = sum(rows.values())
        grouped = Counter()
        for label, n in rows.items():
            grouped[label if label in visible else POOL] += n
        safe = not small(valid, ctx.minimum) and not small(total - valid, ctx.minimum) and all(not small(n, ctx.minimum) for n in grouped.values())
        return grouped, valid, safe

    filterable = all(prepare(frequencies.partitions[cell], n)[2] for cell, n in ctx.partition_totals.items())
    if ctx.filtered and not filterable:
        return {**result, "message": "Esta distribución está disponible sin filtros. Se omiten todas sus subdivisiones para impedir reconstruir categorías protegidas."}
    grouped, valid, safe = prepare(frequencies.selected, ctx.total)
    if not safe:
        return result
    if not valid:
        return {**result, "status": "unavailable", "message": "Esta selección carece de respuestas compatibles para la pregunta."}
    # Only catalogue entries absent from the full cohort, or publicly resolved
    # in every filter atom, can be assigned zero. Reserved labels stay unvalued.
    rows = [(label, grouped[label]) for label in options if label in visible or label not in frequencies.full]
    if grouped[POOL]:
        rows.append((POOL, grouped[POOL]))
    return {**result, "status": "ready", "denominator": valid, "missing": ctx.total - valid,
            "coverage_percentage": round(valid * 100 / ctx.total, 1), "pooled": pooled, "filterable": filterable,
            "definition": analytical_question(key).prompt,
            "message": "La reserva reúne recuentos protegidos. Las opciones reservadas conservan su etiqueta y carecen de frecuencia individual." if pooled else None,
            "data": [{"label": label, "count": n, "percentage": round(n * 100 / valid, 1)} for label, n in rows]}


def comparison(ctx, x, y="dropout_thoughts"):
    title = f"{TITLES[x]} y {TITLES[y].lower()}"
    result = specification(f"{x}__{y}", title, [x, y], "matrix")
    if not ctx.ids[x] or not ctx.ids[y]:
        return {**result, "status": "unavailable", "message": "Falta una variable compatible. Este análisis se habilitará cuando exista una definición y cobertura adecuada."}
    if ctx.total == 0:
        return {**result, "status": "unavailable", "message": "Aún no hay respuestas en esta selección."}
    if ctx.total < ctx.minimum:
        return {**result, "message": f"Se requieren al menos {ctx.minimum} respuestas para divulgar frecuencias."}

    paired = sum(ctx.frequencies(x, y).full.values())
    if paired != sum(ctx.frequencies(x).full.values()) or paired != sum(ctx.frequencies(y).full.values()):
        return {**result, "message": COVERAGE_PROTECTED}
    original = protected_matrix(ctx, x, y, result, {})
    if original is not None:
        return original
    rules = {key: COARSENING[key] for key in (x, y) if key in COARSENING}
    if rules:
        return protected_matrix(ctx, x, y, result, rules) or result
    return result


def protected_matrix(ctx, x, y, result, rules, *, require_filterable=False):
    """None rejects a global grouping plan. A protected selection never changes plans."""
    mappings = {}
    for key, groups in rules.items():
        mapping = {value: label for label, values in groups.items() for value in values}
        global_rows = ctx.frequencies(key).full
        published, _ = safe_categories(global_rows.items(), ctx.minimum)
        visible = {label for label, _ in published if label != POOL}
        # A new margin may merge a protected pool, but must never divide it.
        if len({mapping.get(label, label) for label in global_rows if label not in visible}) > 1:
            return None
        mappings[key] = mapping
    frequencies = ctx.frequencies(x, y)

    def safe(raw, total, x_count, y_count):
        grouped = Counter()
        for (a, b), n in raw.items():
            grouped[(mappings.get(x, {}).get(a, a), mappings.get(y, {}).get(b, b))] += n
        cells = [(a, b, n) for (a, b), n in grouped.items()]
        valid = sum(n for _, _, n in cells)
        # Identical compatible coverage makes the paired margins comparable to
        # the public distributions without isolating a missing subgroup.
        return cells, valid, valid >= ctx.minimum and valid == x_count == y_count and not small(total - valid, ctx.minimum) and all(not small(n, ctx.minimum) for _, _, n in cells)

    fx, fy = ctx.frequencies(x), ctx.frequencies(y)
    _, _, global_safe = safe(frequencies.full, ctx.global_total, sum(fx.full.values()), sum(fy.full.values()))
    if not global_safe:
        return None
    filterable = all(safe(frequencies.partitions[cell], total, sum(fx.partitions[cell].values()), sum(fy.partitions[cell].values()))[2]
                     for cell, total in ctx.partition_totals.items())
    if require_filterable and not filterable:
        return None
    if ctx.filtered and not filterable:
        return {**result, "message": "El cruce está disponible sin filtros. Las subdivisiones podrían revelar celdas o complementos pequeños."}
    cells, valid, valid_safe = safe(frequencies.selected, ctx.total, sum(fx.selected.values()), sum(fy.selected.values()))
    if not valid_safe:
        return result
    original = {key: list(rules[key]) if key in rules else analytical_question(key).options for key in (x, y)}
    rows = [value for value in original[x] if any(a == value for a, _, _ in cells)]
    columns = [value for value in original[y] if not (require_filterable or y in rules) or any(b == value for _, b, _ in cells)]
    matrix = {(a, b): n for a, b, n in cells}
    totals = Counter()
    for a, _, n in cells:
        totals[a] += n
    return {**result, "status": "ready", "denominator": valid, "missing": ctx.total - valid,
            "coverage_percentage": round(valid * 100 / ctx.total, 1), "filterable": filterable,
            "message": None, "rows": rows, "columns": columns,
            "grouping_note": "Las categorías se agrupan para proteger celdas del cruce. La definición muestra las equivalencias." if mappings else None,
            "grouping_rules": rules,
            "definition": result["definition"] + (" Agrupación: " + ". ".join(f"{label}: {'; '.join(values)}" for groups in rules.values() for label, values in groups.items()) if rules else ""),
            "data": [{"label": a, "category": b, "count": matrix.get((a, b), 0), "row_denominator": totals[a],
                      "percentage": round(matrix.get((a, b), 0) * 100 / totals[a], 1)} for a in rows for b in columns]}


def mobility_flow(ctx):
    x, y = "transport_mode", "commute_time"
    result = specification(f"{x}__{y}", "Medio de transporte y tiempo de desplazamiento", [x, y], "matrix")
    if not ctx.ids[x] or not ctx.ids[y]:
        return {**result, "status": "unavailable", "message": "Falta una variable compatible de movilidad."}
    # The flow and its margins are a single release. Use the same plan even
    # unfiltered, and require every flow to be safe in every public filter atom.
    for rules in ({}, FLOW_GROUPS):
        chart = protected_matrix(ctx, x, y, result, rules, require_filterable=True)
        if chart is not None:
            return chart
    return result


def dropout_composition(ctx, chart):
    key = "dropout_thoughts"
    groups = COARSENING[key]
    result = {**specification("dropout_composition", "¿Ha pensado en abandonar?", [key]),
              "definition": "«Nunca» conserva la categoría original. «Ha pensado en abandonar alguna vez» suma Rara vez, Algunas veces, Frecuentemente y Muy frecuentemente.",
              "grouping_rules": {key: groups}}
    if chart["status"] != "ready":
        return {**result, "status": chart["status"], "message": chart["message"]}
    published = {row["label"]: row["count"] for row in chart["data"]}
    if "Nunca" not in published and chart["pooled"]:
        globally_visible, _ = safe_categories(ctx.frequencies(key).full.items(), ctx.minimum)
        if "Nunca" not in dict(globally_visible):
            return result
    never = published.get("Nunca", 0)
    valid = chart["denominator"]
    return {**result, "status": "ready", "denominator": valid, "missing": chart["missing"],
            "coverage_percentage": chart["coverage_percentage"], "filterable": chart["filterable"], "message": None,
            "data": [{"label": label, "count": count, "percentage": round(count * 100 / valid, 1)}
                     for label, count in zip(groups, (never, valid - never))]}


def institutional_rates(ctx, matrix):
    title, categories = RULES["dropout_thoughts"]
    result = {**specification("institutional_dropout_frequency", f"{title} por universidad",
                              ["university", "dropout_thoughts"], "rates"),
              "definition": "Se suman «Frecuentemente» y «Muy frecuentemente» de la matriz publicable. Cada punto usa las respuestas válidas de su universidad.",
              "reference": None}
    if matrix["status"] != "ready":
        return {**result, "status": matrix["status"], "message": matrix["message"]}
    if "dropout_thoughts" in matrix["grouping_rules"]:
        return result
    numerators = Counter()
    bases = {}
    for cell in matrix["data"]:
        bases[cell["label"]] = cell["row_denominator"]
        if cell["category"] in categories:
            numerators[cell["label"]] += cell["count"]
    if not bases:
        return result

    def row(label, count, base):
        return {"label": label, "count": count, "row_denominator": base, "percentage": round(count * 100 / base, 1)}

    valid = matrix["denominator"]
    reference = row("Conjunto seleccionado", sum(numerators.values()), valid) if ctx.university is None and len(bases) > 1 else None
    return {**result, "status": "ready", "denominator": valid, "missing": matrix["missing"],
            "coverage_percentage": matrix["coverage_percentage"], "filterable": matrix["filterable"],
            "message": None, "reference": reference,
            "data": [row(label, numerators[label], base) for label, base in bases.items()]}


def derived_indicator(ctx, key):
    title, values = RULES[key]
    chart = distribution(ctx, key)
    result = {"key": key, "title": title, "type": "derived", "rule": "Se suman exclusivamente: " + "; ".join(values),
              "status": "insufficient", "count": None, "denominator": None, "percentage": None, "message": PROTECTED}
    if chart["status"] == "unavailable":
        return {**result, "status": "unavailable", "message": chart["message"]}
    # An indicator must never unpool a category hidden by its distribution.
    published = {item["label"]: item["count"] for item in chart["data"]}
    frequencies = ctx.frequencies(key)
    observed = frequencies.full
    if chart["status"] != "ready" or any(value in observed and value not in published for value in values):
        return result
    n = sum(published.get(value, 0) for value in values)
    denominator = chart["denominator"]
    # Binary releases also have to be safe throughout the filter partition.
    for cells in frequencies.partitions.values():
        positive = sum(cells.get(value, 0) for value in values)
        valid = sum(cells.values())
        if small(positive, ctx.minimum) or small(valid - positive, ctx.minimum):
            if ctx.filtered:
                return result
            break
    if small(n, ctx.minimum) or small(denominator - n, ctx.minimum):
        return result
    return {**result, "status": "ready", "count": n, "denominator": denominator,
            "percentage": round(n * 100 / denominator, 1), "message": "Regla descriptiva; no expresa una probabilidad de deserción."}


def overview(db: Session, university=None, semester=None):
    ctx = Context(db, university, semester)
    base = ctx.base()
    base["charts"] = [distribution(ctx, key) for key in CHARTS]
    if base["status"] == "ready":
        base["composition"] = dropout_composition(ctx, base["charts"][0])
    return base


def module_data(db: Session, module, university=None, semester=None):
    ctx = Context(db, university, semester)
    base = {**ctx.base(), "module": module, "indicators": [], "quality": [], "versions": [], "institutions": None}
    # Version metadata has no respondent counts and is safe even for an empty DB.
    demo = base["data_mode"] == "demo"
    base["versions"] = [{"version": q.version, "active": q.active, "options_complete": bool(q.provenance.get("option_set_complete"))}
                        for q in db.scalars(select(Questionnaire).order_by(Questionnaire.id))
                        if demo or (q.version != DEMO_VERSION and q.provenance.get("data_mode") != "demo")]
    if module == "academic":
        protected = demo and base["status"] == "insufficient"
        base["mobility"] = {"status": "insufficient" if protected else "unavailable", "charts": [], "comparisons": [],
                            "message": PROTECTED if protected else "Todavía no se han recopilado datos de movilidad en este entorno."}
    if module in {"quality", "methodology"}:
        base["sources"] = ["Generador reproducible de SAVRA · registros completamente sintéticos"] if demo else [
            "Encuesta estudiantil propia · Microsoft Forms e instrumento integrado SAVRA"]
        base["received_responses"] = None
        base["received_message"] = ("Las respuestas de esta base se generan mediante la CLI y se validan con el instrumento de demostración." if demo else
                                    "El total recibido se reserva a la CLI: los lotes pueden solaparse y los descartes o la diferencia entre orígenes pueden formar grupos menores de cinco.")
    if module == "academic":
        base["charts"] = [comparison(ctx, key) for key in PAIRS]
        if demo and base["status"] == "ready":
            charts = [distribution(ctx, key) for key in MOBILITY_TITLES]
            if any(chart["status"] != "unavailable" for chart in charts):
                base["mobility"] = {"status": "ready", "charts": charts, "flow": mobility_flow(ctx),
                                    "comparisons": [comparison(ctx, key) for key in ("transport_mode", "commute_time", "mobility_delay")],
                                    "message": "Cruces exploratorios con la frecuencia declarada de pensamientos de abandono."}
    elif module == "permanence":
        keys = ["motivation", "economic_difficulty", "academic_load", "institutional_support", "dropout_thoughts",
                "enrollment_likelihood", "absence_frequency", "failed_courses", "work_hours"]
        base["charts"] = [distribution(ctx, key) for key in keys]
        if base["status"] == "ready":
            base["indicators"] = [derived_indicator(ctx, key) for key in RULES]
    elif module == "institutional":
        base["charts"] = [distribution(ctx, "university"), *[comparison(ctx, "university", key) for key in ("dropout_thoughts", "motivation", "economic_difficulty", "institutional_support", "semester")]]
        if base["status"] == "ready":
            base["institutional_points"] = institutional_rates(ctx, base["charts"][1])
        # The comparative table is the exact same protected cells as each chart.
        base["institutions"] = {"status": "ready" if any(c["status"] == "ready" for c in base["charts"][1:]) else "insufficient",
                                "message": "Comparación descriptiva sin rankings. Las bases corresponden a respuestas conjuntas válidas por universidad."}
    elif module in {"quality", "methodology"}:
        if module == "quality" and base["status"] == "ready":
            for key in TITLES if demo else (key for key in TITLES if key not in MOBILITY_TITLES):
                base["quality"].append(coverage(ctx, key))
    return base


def coverage(ctx, key):
    result = {"key": key, "title": TITLES[key], "kind": "ordinal" if key in ORDINAL else "categorical",
              "status": "insufficient", "valid": None, "missing": None, "coverage_percentage": None, "message": PROTECTED}
    if not ctx.ids[key]:
        return {**result, "status": "unavailable", "message": "Variable ausente o sin compatibilidad explícita."}
    frequencies = ctx.frequencies(key)
    global_valid = sum(frequencies.full.values())
    if not global_valid:
        return {**result, "status": "unavailable", "message": "No se han recopilado valores compatibles."}
    if small(global_valid, ctx.minimum) or small(ctx.global_total - global_valid, ctx.minimum):
        return result
    if ctx.filtered:
        for cell, total in ctx.partition_totals.items():
            valid = sum(frequencies.partitions[cell].values())
            if small(valid, ctx.minimum) or small(total - valid, ctx.minimum):
                return result
    n = sum(frequencies.selected.values())
    return {**result, "status": "ready", "valid": n, "missing": ctx.total - n,
            "coverage_percentage": round(n * 100 / ctx.total, 1), "message": None}
