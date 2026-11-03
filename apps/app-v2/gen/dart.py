"""Turns spec fields into Dart: types, JSON reading/writing, display text, samples."""
from __future__ import annotations

import json
import re

from .spec import Entity, Field, Spec, SpecError, resolve, text_item

STRINGY = {"id", "text", "multiline", "email", "phone", "country", "money"}

FORM_KIND = {
    "text": "text", "multiline": "multiline", "email": "email", "phone": "phone", "country": "country",
    "int": "integer", "bool": "toggle", "date": "date", "datetime": "date", "money": "decimal", "enum": "choice",
}


def q(s: str) -> str:
    """A Dart single-quoted string literal."""
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$").replace("\n", "\\n") + "'"


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def lower_first(name: str) -> str:
    return name[:1].lower() + name[1:]


def nullable(f: Field) -> bool:
    if f.kind in ("list", "int", "bool"):
        return False
    if f.kind == "id":
        return False
    if f.kind in ("date", "datetime", "money", "obj"):
        return True
    return not (f.required or f.default is not None)


def dart_type(f: Field) -> str:
    base = {
        "int": "int", "bool": "bool", "date": "DateTime", "datetime": "DateTime",
        "obj": f.ref or "", "list": f"List<{f.ref}>",
    }.get(f.kind, "String")
    return base + ("?" if nullable(f) else "")


def from_json(f: Field) -> str:
    k = q(f.name)
    if f.kind == "list":
        return f"j.list({k}, {f.ref}.fromJson)"
    if f.kind == "obj":
        return f"j.obj({k}, {f.ref}.fromJson)"
    if f.kind == "int":
        return f"j.integer({k})"
    if f.kind == "bool":
        return f"j.boolean({k})"
    if f.kind in ("date", "datetime"):
        return f"j.date({k})"
    if nullable(f):
        return f"j.strOrNull({k})"
    return f"j.str({k}, {q(str(f.default))})" if f.default is not None else f"j.str({k})"


def to_json(f: Field) -> str | None:
    """The value sent back to the API, or None when the field is not sent."""
    if f.kind == "obj" or (f.readonly and f.kind != "id"):
        return None
    n = f.name
    if f.kind == "list":
        return f"{n}.map((e) => e.toJson()).toList()"
    if f.kind == "date":
        return f"isoDay({n})"
    if f.kind == "datetime":
        return f"{n}?.toIso8601String()"
    return n


def enum_class(name: str) -> str:
    return f"{name}Enum"


def field_def(spec: Spec, e: Entity, f: Field) -> str:
    """`FieldDef(...)`: what a form needs to show and check one field."""
    args = [q(f.name), q(f.label), f"FieldKind.{FORM_KIND[f.kind]}"]
    if f.required:
        args.append("required: true")
    if f.max:
        args.append(f"max: {f.max}")
    if f.hint:
        args.append(f"hint: {q(f.hint)}")
    if f.upper:
        args.append("upper: true")
    if f.kind == "enum":
        args.append(f"options: {enum_class(f.ref)}.labels")
    if f.default is not None:
        args.append(f"defaultValue: {q(str(f.default))}")
    return f"FieldDef({', '.join(args)})"


def access(chain: list[Field], var: str) -> str:
    """Customer.primaryContact.name on `c` → `c.primaryContact?.name`."""
    out = var
    for i, f in enumerate(chain):
        out += ("?." if i > 0 and nullable(chain[i - 1]) else ".") + f.name
    return out


def display(spec: Spec, entity: str, item, var: str) -> str:
    """A Dart expression of type String? showing a field the way people read it."""
    it = text_item(item)
    chain = resolve(spec, entity, it["of"], entity)
    f = chain[-1]
    v = access(chain, var)
    if f.kind == "country":
        out = f"countryName({v})"
    elif f.kind == "enum":
        out = f"{enum_class(f.ref)}.label({v})"
    elif f.kind in ("date", "datetime"):
        out = f"fmtDate({v})"
    elif f.kind == "money":
        out = f"fmtMoney({v}, {currency_of(spec, entity, chain, var)})"
    elif f.kind == "bool":
        out = f"({v} == true ? {q(f.label)} : null)"
    elif f.kind == "int":
        text = it.get("text")
        if text:
            one, many = text, text
            if "|" in text:
                base, plural = text.rsplit("|", 1)
                one = base
                many = base[: base.rfind(" ") + 1] + plural if " " in base else plural
            hz = ", hideZero: true" if it.get("hide_zero") else ""
            out = f"count({v}, {q(one)}, {q(many)}{hz})"
        else:
            out = f"'${{{v}}}'"
    else:
        out = v
    if it.get("text") and f.kind != "int":
        out = f"fill({q(it['text'])}, {out})"
    return out


def currency_of(spec: Spec, entity: str, chain: list[Field], var: str) -> str:
    """The currency of a money field: its own record's field, else the nearest record holding it."""
    name = chain[-1].currency
    owners = [entity] + [f.ref for f in chain[:-1]]  # the record at each level
    for level in range(len(chain) - 1, -1, -1):
        if name in spec.entities[owners[level]].fields:
            base = access(chain[:level], var) if level else var
            dot = "?." if level and nullable(chain[level - 1]) else "."
            return f"{base}{dot}{name}"
    raise SpecError(f"{entity}: no '{name}' field holds the currency of {chain[-1].name}")


def label_of(spec: Spec, entity: str, item) -> str:
    """The label shown for a path: given, else the field's; "x.name" takes x's label."""
    it = text_item(item)
    if it.get("label"):
        return it["label"]
    chain = resolve(spec, entity, it["of"], entity)
    if len(chain) > 1 and chain[-1].name == "name":
        return chain[-2].label
    return chain[-1].label


# ---------------------------------------------------------------- samples for tests


def sample(spec: Spec, entity: str, depth: int = 0) -> dict:
    e = spec.entities[entity]
    out: dict = {}
    for f in e.fields.values():
        if f.kind == "id":
            out[f.name] = f"{snake(entity)}-1"
        elif f.kind == "enum":
            out[f.name] = str(f.default) if f.default is not None else next(iter(spec.enums[f.ref]))
        elif f.kind == "country":
            out[f.name] = "PK"
        elif f.kind == "email":
            out[f.name] = "ali@example.com"
        elif f.kind == "phone":
            out[f.name] = "+92 300 1234567"
        elif f.kind == "int":
            out[f.name] = 2
        elif f.kind == "bool":
            out[f.name] = False
        elif f.kind == "date":
            out[f.name] = "2026-10-28"
        elif f.kind == "datetime":
            out[f.name] = "2026-10-28T09:00:00.000Z"
        elif f.kind == "money":
            out[f.name] = "1250.50"
        elif f.kind == "obj":
            if depth < 2:
                out[f.name] = sample(spec, f.ref, depth + 1)
        elif f.kind == "list":
            out[f.name] = [sample(spec, f.ref, depth + 1)] if depth < 2 else []
        elif f.name == "currency":
            out[f.name] = "USD"
        else:
            out[f.name] = f"{entity} {f.label.lower()}"
    return out


def dart_json(value) -> str:
    """A JSON value as a Dart literal (for tests)."""
    return q(json.dumps(value))
