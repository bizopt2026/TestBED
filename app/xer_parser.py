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


def decode(raw: bytes) -> str:
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


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
