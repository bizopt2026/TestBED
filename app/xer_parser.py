"""Primavera P6 XER 파일 파서.

XER은 탭으로 구분된 텍스트 파일이다:
    ERMHDR  ...            (헤더)
    %T  TABLE_NAME         (테이블 시작)
    %F  col1  col2 ...     (컬럼 정의)
    %R  v1    v2   ...     (행)
    %E                     (파일 끝)
"""
from __future__ import annotations

from datetime import datetime

ENCODINGS = ("utf-8-sig", "cp949", "cp1252", "latin-1")


def detect_encoding(raw: bytes) -> str:
    for enc in ENCODINGS:
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def decode(raw: bytes) -> str:
    return raw.decode(detect_encoding(raw), errors="replace")


def parse_tables(text: str) -> dict[str, list[dict[str, str]]]:
    tables: dict[str, list[dict[str, str]]] = {}
    current: str | None = None
    fields: list[str] = []
    saw_header = False
    for line in text.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        tag = parts[0]
        if tag == "ERMHDR":
            saw_header = True
        elif tag == "%T":
            current = parts[1].strip() if len(parts) > 1 else None
            if current:
                tables.setdefault(current, [])
            fields = []
        elif tag == "%F":
            fields = [f.strip() for f in parts[1:]]
        elif tag == "%R" and current is not None:
            values = parts[1:]
            values += [""] * (len(fields) - len(values))
            tables[current].append(dict(zip(fields, values)))
        elif tag == "%E":
            break
    if not saw_header and not tables:
        raise ValueError("XER 형식이 아닙니다 (ERMHDR/%T 레코드를 찾을 수 없음)")
    return tables


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def parse_float(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


def parse_xer(raw: bytes) -> dict[str, list[dict[str, str]]]:
    return parse_tables(decode(raw))


def header_line(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("ERMHDR"):
            return line
    return "ERMHDR\t19.12"


def write_xer(tables: dict[str, list[dict[str, str]]], header: str,
              fields: dict[str, list[str]] | None = None) -> str:
    """테이블 dict -> XER 텍스트. fields 로 원본 컬럼 순서를 유지."""
    out = [header]
    for name, rows in tables.items():
        cols = list((fields or {}).get(name) or [])
        for r in rows:
            for k in r:
                if k not in cols:
                    cols.append(k)
        out.append(f"%T\t{name}")
        out.append("%F\t" + "\t".join(cols))
        for r in rows:
            out.append("%R\t" + "\t".join(str(r.get(c, "") or "") for c in cols))
    out.append("%E")
    return "\r\n".join(out) + "\r\n"


def table_fields(text: str) -> dict[str, list[str]]:
    fields, cur = {}, None
    for line in text.splitlines():
        parts = line.split("\t")
        if parts[0] == "%T" and len(parts) > 1:
            cur = parts[1].strip()
        elif parts[0] == "%F" and cur:
            fields[cur] = [f.strip() for f in parts[1:]]
    return fields
