"""Reads spec/*.yaml into plain objects and checks them.

Any mistake stops the run with the file and the reason, so the generated
code is never written from a broken spec.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec"

SCALARS = {"id", "text", "multiline", "email", "phone", "country", "int", "number", "bool", "date", "datetime", "money", "raw"}
FRAMES = {"list", "record", "sheet"}
TONES = {"neutral", "info", "ok", "warn", "bad"}
CONTACT_ACTIONS = {"phone", "whatsapp", "email"}


class SpecError(Exception):
    pass


class _Loader(yaml.SafeLoader):
    """YAML where only true/false are booleans: a field called "no" or "on" stays a name."""


_Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:bool"] for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_Loader.add_implicit_resolver("tag:yaml.org,2002:bool", __import__("re").compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF"))


def words(name: str) -> str:
    """taxNo → "Tax no", defaultCurrency → "Default currency"."""
    s = re.sub(r"(?<!^)(?=[A-Z])", " ", name).lower()
    return s[:1].upper() + s[1:]


@dataclass
class Field:
    name: str
    kind: str  # one of SCALARS, or enum / obj / list
    label: str
    required: bool = False
    readonly: bool = False
    ref: str | None = None  # enum name or entity name
    max: int | None = None
    min: int | None = None
    hint: str | None = None
    upper: bool = False
    default: Any = None
    currency: str | None = None  # money: the field holding the currency
    source: str | None = None  # pick: where the choices come from (an API list, or "settings:<path>")
    suggest: str | None = None  # text: a list of quick reasons in app.yaml


@dataclass
class Entity:
    name: str
    fields: dict[str, Field]
    api: str | None = None
    paged: bool = False
    duplicate_flag: str | None = None
    permissions: dict[str, str] = field(default_factory=dict)
    rules: list[dict] = field(default_factory=list)
    source: str = ""


@dataclass
class Screen:
    name: str
    frame: str
    entity: str
    raw: dict
    source: str


@dataclass
class Spec:
    app: dict
    enums: dict[str, dict[str, dict]]  # name → value → {label, tone}
    entities: dict[str, Entity]
    screens: dict[str, Screen]


def _docs(path: Path) -> list[dict]:
    try:
        return [d for d in yaml.load_all(path.read_text(), Loader=_Loader) if d]
    except yaml.YAMLError as e:
        raise SpecError(f"{path.name}: not valid YAML: {e}") from e


def _field(ent: str, name: str, raw: Any, where: str) -> Field:
    if isinstance(raw, str):
        raw = {"type": raw}
    if not isinstance(raw, dict):
        raise SpecError(f"{where}: {ent}.{name}: write a type or a map")
    raw = dict(raw)
    ref = None
    if "enum" in raw:
        kind, ref = "enum", raw.pop("enum")
    elif "obj" in raw:
        kind, ref = "obj", raw.pop("obj")
    elif "list" in raw:
        kind, ref = "list", raw.pop("list")
    elif "pick" in raw:
        kind = "pick"
        raw["source"] = raw.pop("pick")
    else:
        kind = str(raw.pop("type", ""))
    required = kind.endswith("!")
    kind = kind.rstrip("!")
    if kind not in SCALARS | {"enum", "obj", "list", "pick"}:
        raise SpecError(f"{where}: {ent}.{name}: unknown type '{kind}' (use one of {', '.join(sorted(SCALARS))}, enum, obj, list)")
    known = {"label", "readonly", "max", "min", "hint", "upper", "default", "currency", "required", "source", "suggest"}
    extra = set(raw) - known
    if extra:
        raise SpecError(f"{where}: {ent}.{name}: unknown key(s) {', '.join(sorted(extra))}")
    return Field(
        name=name,
        kind=kind,
        label=raw.get("label") or words(name),
        required=required or bool(raw.get("required")),
        readonly=bool(raw.get("readonly")) or kind == "id",
        ref=ref,
        max=raw.get("max"),
        min=raw.get("min"),
        hint=raw.get("hint"),
        upper=bool(raw.get("upper")),
        default=raw.get("default"),
        currency=raw.get("currency"),
        source=raw.get("source"),
        suggest=raw.get("suggest"),
    )


def inline_fields(owner: str, raw: dict, where: str) -> list[Field]:
    """Fields written inside a screen (an action's form)."""
    return [_field(owner, k, v, where) for k, v in (raw or {}).items()]


def load() -> Spec:
    app_docs = _docs(SPEC / "app.yaml")
    if len(app_docs) != 1:
        raise SpecError("app.yaml: one document expected")
    app = app_docs[0]

    enums: dict[str, dict[str, dict]] = {}
    for ename, values in (app.get("enums") or {}).items():
        enums[ename] = {}
        for v, meta in values.items():
            meta = {"label": meta} if isinstance(meta, str) else dict(meta)
            tone = meta.get("tone", "neutral")
            if tone not in TONES:
                raise SpecError(f"app.yaml: {ename}.{v}: tone '{tone}' is not one of {', '.join(sorted(TONES))}")
            enums[ename][str(v)] = {"label": meta.get("label") or words(str(v)), "tone": tone}

    entities: dict[str, Entity] = {}
    for path in sorted((SPEC / "entities").glob("*.yaml")):
        for d in _docs(path):
            name = d.get("entity")
            if not name:
                raise SpecError(f"{path.name}: a document without 'entity'")
            if name in entities:
                raise SpecError(f"{path.name}: {name} is defined twice (also in {entities[name].source})")
            fields = {k: _field(name, k, v, path.name) for k, v in (d.get("fields") or {}).items()}
            entities[name] = Entity(
                name=name,
                fields=fields,
                api=d.get("api"),
                paged=bool(d.get("paged")),
                duplicate_flag=d.get("duplicate_flag"),
                permissions=d.get("permissions") or {},
                rules=d.get("rules") or [],
                source=path.name,
            )

    screens: dict[str, Screen] = {}
    for path in sorted((SPEC / "screens").glob("*.yaml")):
        for d in _docs(path):
            name = d.get("screen")
            if not name or d.get("frame") not in FRAMES:
                raise SpecError(f"{path.name}: every screen needs 'screen' and a 'frame' of {', '.join(sorted(FRAMES))}")
            if name in screens:
                raise SpecError(f"{path.name}: screen {name} is defined twice")
            screens[name] = Screen(name=name, frame=d["frame"], entity=d.get("entity", ""), raw=d, source=path.name)

    spec = Spec(app=app, enums=enums, entities=entities, screens=screens)
    check(spec)
    return spec


# ---------------------------------------------------------------- checks


def resolve(spec: Spec, entity: str, path: str, where: str) -> list[Field]:
    """"primaryContact.name" on Customer → [Customer.primaryContact, Contact.name]."""
    chain: list[Field] = []
    ent = spec.entities[entity]
    parts = path.split(".")
    for i, part in enumerate(parts):
        f = ent.fields.get(part)
        if not f:
            raise SpecError(f"{where}: {ent.name} has no field '{part}' (in '{path}')")
        chain.append(f)
        if i < len(parts) - 1:
            if f.kind != "obj":
                raise SpecError(f"{where}: '{path}': {part} is not an object")
            ent = spec.entities[f.ref]
    return chain


def text_item(item: Any) -> dict:
    """A sub/value entry: "field" or { of, text, hide_zero }."""
    if isinstance(item, str):
        return {"of": item}
    if isinstance(item, dict) and "of" in item:
        return item
    raise SpecError(f"write a field name or {{ of: field, text: '…' }}, not {item!r}")


METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def check(spec: Spec) -> None:
    for e in spec.entities.values():
        for f in e.fields.values():
            where = f"{e.source}: {e.name}.{f.name}"
            if f.kind == "enum" and f.ref not in spec.enums:
                raise SpecError(f"{where}: no enum '{f.ref}' in app.yaml")
            if f.kind in ("obj", "list") and f.ref not in spec.entities:
                raise SpecError(f"{where}: no entity '{f.ref}'")
            if f.kind == "money" and not f.currency:
                raise SpecError(f"{where}: money needs 'currency: <field>' (a field of this record or of the one holding it)")
            if f.suggest and f.suggest not in (spec.app.get("reasons") or {}):
                raise SpecError(f"{where}: suggest: no reasons '{f.suggest}' in app.yaml")
            if f.kind == "enum" and f.default is not None and str(f.default) not in spec.enums[f.ref]:
                raise SpecError(f"{where}: default '{f.default}' is not a value of {f.ref}")
        for r in e.rules:
            for k in r.get("any", []):
                if k not in e.fields:
                    raise SpecError(f"{e.source}: {e.name} rule names unknown field '{k}'")

    paths: dict[str, str] = {}
    for s in spec.screens.values():
        where = f"{s.source}: {s.name}"
        if s.entity not in spec.entities:
            raise SpecError(f"{where}: no entity '{s.entity}'")
        ent = spec.entities[s.entity]
        raw = s.raw
        if s.frame in ("list", "record"):
            p = raw.get("path")
            if not p or not p.startswith("/"):
                raise SpecError(f"{where}: a {s.frame} screen needs a path starting with /")
            if p in paths:
                raise SpecError(f"{where}: path {p} is also used by {paths[p]}")
            paths[p] = s.name
            if not ent.api:
                raise SpecError(f"{where}: {ent.name} has no 'api', so it cannot be loaded")
        if s.frame == "list":
            _row(spec, ent.name, raw.get("row") or {}, where)
            for key in ("open", "add"):
                if raw.get(key) and raw[key] not in spec.screens:
                    raise SpecError(f"{where}: {key}: no screen '{raw[key]}'")
            if raw.get("add") and spec.screens[raw["add"]].frame != "sheet":
                raise SpecError(f"{where}: add: must open a sheet")
        if s.frame == "record":
            primaries = [raw["primary"]] if raw.get("primary") else []
            if len(primaries) > 1:
                raise SpecError(f"{where}: one primary action per screen")
            for a in primaries + (raw.get("more") or []):
                if a.get("sheet") and a["sheet"] not in spec.screens:
                    raise SpecError(f"{where}: no sheet '{a['sheet']}'")
                if not (a.get("sheet") or a.get("delete") or a.get("post") or a.get("run")):
                    raise SpecError(f"{where}: action '{a.get('label')}' needs sheet, delete, post or run")
                if a.get("run") and not re.fullmatch(r"[a-z][a-z0-9_]*\.[a-z][A-Za-z0-9]*", str(a["run"])):
                    raise SpecError(f"{where}: action '{a.get('label')}': run: '{a['run']}' must be file.function, e.g. delivery.openDelivery")
                for k in (a.get("when") or {}):
                    if k not in ent.fields:
                        raise SpecError(f"{where}: action '{a.get('label')}': when: {ent.name} has no field '{k}'")
                for f in inline_fields(s.name, a.get("fields") or {}, where):
                    if f.kind == "enum" and f.ref not in spec.enums:
                        raise SpecError(f"{where}: action '{a.get('label')}': no enum '{f.ref}'")
                    if f.suggest and f.suggest not in (spec.app.get("reasons") or {}):
                        raise SpecError(f"{where}: action '{a.get('label')}': no reasons '{f.suggest}'")
            h = raw.get("header") or {}
            for item in [h.get("title", ""), *h.get("sub", []), *([h["badge"]] if h.get("badge") else []), *h.get("flags", [])]:
                resolve(spec, ent.name, text_item(item)["of"], where)
            for fl in h.get("flags", []):
                if fl.get("tone", "neutral") not in TONES or not fl.get("label"):
                    raise SpecError(f"{where}: a flag needs a label and a tone of {', '.join(sorted(TONES))}")
            for sec in raw.get("sections") or []:
                if "custom" in sec:
                    if not re.fullmatch(r"[A-Z][A-Za-z0-9]+", str(sec["custom"])):
                        raise SpecError(f"{where}: custom: '{sec['custom']}' must be a widget name like OrderPapers")
                elif "history" in sec:
                    if sec["history"] not in ("deal", "order", "customer", "factory"):
                        raise SpecError(f"{where}: history: '{sec['history']}' must be deal, order, customer or factory")
                elif "fields" in sec:
                    for f in sec["fields"]:
                        resolve(spec, ent.name, text_item(f)["of"], where)
                elif "list" in sec:
                    lf = resolve(spec, ent.name, sec["list"], where)[-1]
                    if lf.kind != "list":
                        raise SpecError(f"{where}: section '{sec.get('title')}': {sec['list']} is not a list")
                    _row(spec, lf.ref, sec.get("row") or {}, where)
                    if sec.get("open"):
                        o = sec["open"] if isinstance(sec["open"], dict) else {"screen": sec["open"], "id": "id"}
                        t = spec.screens.get(o.get("screen"))
                        if not t or t.frame != "record":
                            raise SpecError(f"{where}: section '{sec.get('title')}': open: no record screen '{o.get('screen')}'")
                        resolve(spec, lf.ref, o.get("id", "id"), where)
                    for a in sec.get("actions") or []:
                        if a not in CONTACT_ACTIONS or a not in spec.entities[lf.ref].fields:
                            raise SpecError(f"{where}: action '{a}' must be one of {', '.join(sorted(CONTACT_ACTIONS))} and a field of {lf.ref}")
                else:
                    raise SpecError(f"{where}: a section needs 'fields', 'list', 'history' or 'custom'")
        if s.frame == "sheet":
            if not raw.get("save"):
                raise SpecError(f"{where}: a sheet needs a 'save' label")
            for g in raw.get("groups") or []:
                target = ent.name
                if g.get("list"):
                    lf = resolve(spec, ent.name, g["list"], where)[-1]
                    if lf.kind != "list":
                        raise SpecError(f"{where}: {g['list']} is not a list")
                    target = lf.ref
                for f in g.get("fields") or []:
                    fd = resolve(spec, target, f, where)[-1]
                    if fd.readonly or fd.kind in ("obj", "list"):
                        raise SpecError(f"{where}: {target}.{f} cannot be edited in a form")


def _row(spec: Spec, entity: str, row: dict, where: str) -> None:
    if not row.get("title"):
        raise SpecError(f"{where}: a row needs a title")
    items = [row["title"], *row.get("sub", [])]
    if row.get("value"):
        items.append(row["value"])
    for it in items:
        resolve(spec, entity, text_item(it)["of"], where)
    if row.get("badge"):
        f = resolve(spec, entity, row["badge"], where)[-1]
        if f.kind != "enum":
            raise SpecError(f"{where}: badge '{row['badge']}' must be an enum field")
