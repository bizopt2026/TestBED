"""엑셀 양식(xlsx) 채우기 엔진.

사용자 양식의 서식·차트·이미지·수식을 보존하기 위해 openpyxl 로 다시 저장하지 않고,
xlsx(zip) 안의 시트 XML 에서 자리표시자 셀만 직접 고친다.

  - 값 자리표시자:  셀에 {{project.finish}} → 값으로 교체 (셀 서식이 날짜면 날짜 값으로)
  - 반복 행:       행에 {{critical.code}} 같은 목록 필드가 있으면 항목 수만큼 아래로 채움
                   (아래 행이 비어 있는 동안만 채우고, 다른 내용을 만나면 멈춤 → 차트·표 참조를 깨지 않음)
                   표(Excel Table) 범위·병합 셀·조건부 서식·수식의 행 참조를 함께 늘림
  - 머리글/바닥글의 값 자리표시자도 교체, 파일을 열 때 수식 전체 재계산 지정
보안: 매크로(.xlsm) 거부, 압축 해제 크기·항목 수 제한, XML 외부 엔티티 비활성화.
"""
from __future__ import annotations

import io
import re
import zipfile
from copy import deepcopy
from datetime import date

from lxml import etree

from .report_context import LISTS, SCALARS

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
X = f"{{{M}}}"
PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_blank_text=False)
PH = re.compile(r"(?<!\\)\{\{\s*([^{}]+?)\s*\}\}")   # \{{ 는 자리표시자가 아닌 글자 그대로
LIST_REF = re.compile(r"^([A-Za-z_]\w*)(?:\[(\d+)\])?\.(#|\w+)$")
MAX_ENTRIES, MAX_TOTAL = 3000, 200 * 1024 * 1024
DATE_FMT_IDS = set(range(14, 23)) | {45, 46, 47}


class TemplateError(ValueError):
    pass


# ---------------------------------------------------------------- 유틸
def col2n(c: str) -> int:
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def n2col(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref: str) -> tuple[str, int]:
    m = re.match(r"([A-Z]+)(\d+)", ref)
    return m.group(1), int(m.group(2))


def parse_expr(expr: str):
    parts = [p.strip() for p in expr.split("|")]
    path, filters = parts[0], parts[1:]
    if path in SCALARS:
        return ("scalar", path, None, None, filters)
    m = LIST_REF.match(path)
    if m and m.group(1) in LISTS:
        return ("list", m.group(1), int(m.group(2)) if m.group(2) else None, m.group(3), filters)
    return ("scalar", path, None, None, filters)


def apply_filters(v, filters: list[str]):
    for f in filters:
        name, _, arg = f.partition(":")
        name = name.strip()
        if name == "default" and (v is None or v == ""):
            v = arg
        elif name == "date" and v:
            try:
                v = date.fromisoformat(str(v)[:10]).strftime(arg or "%Y-%m-%d")
            except ValueError:
                pass
        elif name == "num" and isinstance(v, (int, float)):
            v = round(v, int(arg or 0))
            if not arg or int(arg) == 0:
                v = int(v)
        elif name == "pct" and isinstance(v, (int, float)):
            v = v / 100
        elif name == "upper" and isinstance(v, str):
            v = v.upper()
        elif name == "yn":
            v = "Y" if v in (True, "Y", 1) else "N"
    return v


class Book:
    def __init__(self, raw: bytes):
        if not raw[:2] == b"PK":
            raise TemplateError("엑셀(.xlsx) 파일이 아닙니다")
        try:
            self.z = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise TemplateError("손상된 엑셀 파일입니다")
        infos = self.z.infolist()
        if len(infos) > MAX_ENTRIES or sum(i.file_size for i in infos) > MAX_TOTAL:
            raise TemplateError("양식 파일이 너무 큽니다")
        names = {i.filename for i in infos}
        if any(n.lower().endswith("vbaproject.bin") for n in names):
            raise TemplateError("매크로가 포함된 파일(.xlsm)은 지원하지 않습니다. 매크로 없는 .xlsx로 저장해 주세요.")
        if "xl/workbook.xml" not in names:
            raise TemplateError("엑셀 통합문서(.xlsx) 구조가 아닙니다")
        self.files = {n: self.z.read(n) for n in names}
        self.xml: dict[str, etree._Element] = {}
        self.removed: set[str] = set()
        wb = self.load("xl/workbook.xml")
        rels = self.load("xl/_rels/workbook.xml.rels")
        rmap = {r.get("Id"): r.get("Target") for r in rels.iter(f"{{{P}}}Relationship")}
        self.sheets = []
        for s in wb.iter(X + "sheet"):
            t = rmap.get(s.get(f"{{{R}}}id"), "")
            path = t.lstrip("/") if t.startswith("/") else "xl/" + t
            self.sheets.append((s.get("name"), path))
        self.shared = []
        if "xl/sharedStrings.xml" in self.files:
            ss = self.load("xl/sharedStrings.xml")
            self.shared = ["".join(si.itertext()) for si in ss.iter(X + "si")]
        self.date_styles = self._date_styles()

    def load(self, name: str):
        if name not in self.xml:
            self.xml[name] = etree.fromstring(self.files[name], PARSER)
        return self.xml[name]

    def _date_styles(self) -> set[int]:
        if "xl/styles.xml" not in self.files:
            return set()
        st = self.load("xl/styles.xml")
        custom = {}
        for nf in st.iter(X + "numFmt"):
            code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", nf.get("formatCode", "")).lower()
            custom[int(nf.get("numFmtId"))] = bool(re.search(r"[yd]", code)) or ("m" in code and "h" not in code and "s" not in code and "0" not in code)
        out = set()
        cx = st.find(X + "cellXfs")
        for i, xf in enumerate(cx.findall(X + "xf") if cx is not None else []):
            fid = int(xf.get("numFmtId", "0"))
            if fid in DATE_FMT_IDS or custom.get(fid):
                out.add(i)
        return out

    def cell_text(self, c) -> str | None:
        t = c.get("t")
        if t == "s":
            v = c.find(X + "v")
            try:
                return self.shared[int(v.text)] if v is not None else None
            except (ValueError, IndexError):
                return None
        if t == "inlineStr":
            is_ = c.find(X + "is")
            return "".join(is_.itertext()) if is_ is not None else None
        if t == "str":
            return None  # 수식 결과 문자열
        return None

    def sheet_rels(self, path: str) -> dict:
        d, f = path.rsplit("/", 1)
        rp = f"{d}/_rels/{f}.rels"
        if rp not in self.files:
            return {}
        rels = self.load(rp)
        out = {}
        for r in rels.iter(f"{{{P}}}Relationship"):
            tgt = r.get("Target")
            full = tgt.lstrip("/") if tgt.startswith("/") else _norm(f"{d}/{tgt}")
            out[r.get("Id")] = (r.get("Type", "").rsplit("/", 1)[-1], full)
        return out

    def save(self) -> bytes:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zw:
            for info in self.z.infolist():
                n = info.filename
                if n in self.removed:
                    continue
                data = etree.tostring(self.xml[n], xml_declaration=True, encoding="UTF-8", standalone=True) if n in self.xml else self.files[n]
                zw.writestr(info, data)
        return out.getvalue()


def _norm(p: str) -> str:
    parts = []
    for x in p.split("/"):
        if x == "..":
            if parts:
                parts.pop()
        elif x and x != ".":
            parts.append(x)
    return "/".join(parts)


# ---------------------------------------------------------------- 셀 쓰기
def _clear(c):
    for ch in list(c):
        if ch.tag in (X + "v", X + "is", X + "f"):
            c.remove(ch)
    c.attrib.pop("t", None)


def _set_text(c, text: str):
    _clear(c)
    c.set("t", "inlineStr")
    is_ = etree.SubElement(c, X + "is")
    t = etree.SubElement(is_, X + "t")
    t.text = text
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def _set_value(c, v, is_date_style: bool):
    if v is None or v == "":
        _clear(c)
        return
    if isinstance(v, bool):
        return _set_text(c, "Y" if v else "N")
    if isinstance(v, (int, float)):
        _clear(c)
        etree.SubElement(c, X + "v").text = repr(float(v)) if isinstance(v, float) else str(v)
        return
    s = str(v)
    if is_date_style and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        _clear(c)
        etree.SubElement(c, X + "v").text = str((date.fromisoformat(s) - date(1899, 12, 30)).days)
        return
    _set_text(c, s)


def shift_formula(f: str, row: int, delta: int) -> str:
    """수식 안의 같은 행 상대 참조(A5, $A5)를 delta 만큼 내린다. $5 처럼 행 고정은 그대로."""
    def rep(m):
        col, dollar, r = m.group(1), m.group(2), int(m.group(3))
        if dollar or r != row:
            return m.group(0)
        return f"{col}{r + delta}"
    return re.sub(r"(?<![A-Za-z_\"'!])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])", rep, f)


# ---------------------------------------------------------------- 렌더링
def scan(raw: bytes) -> dict:
    """양식 점검: 시트별 자리표시자, 알 수 없는 필드."""
    b = Book(raw)
    found, unknown = [], []
    for name, path in b.sheets:
        if path not in b.files:
            continue
        sh = b.load(path)
        for c in sh.iter(X + "c"):
            txt = b.cell_text(c)
            if not txt:
                continue
            for expr in PH.findall(txt):
                kind, key, lim, field, _ = parse_expr(expr)
                ok = (key in SCALARS) if kind == "scalar" else (field == "#" or field in LISTS[key][1])
                (found if ok else unknown).append({"sheet": name, "cell": c.get("r"), "expr": expr})
    return {"sheets": [s for s, _ in b.sheets], "found": found, "unknown": unknown,
            "lists": sorted({parse_expr(f["expr"])[1] for f in found if parse_expr(f["expr"])[0] == "list"})}


def render(raw: bytes, ctx) -> tuple[bytes, list[str], dict]:
    b = Book(raw)
    warnings: list[str] = []
    stats = {"values": 0, "rows": 0}

    def get_scalar(key, filters):
        try:
            v = ctx.scalar(key)
        except KeyError:
            warnings.append(f"알 수 없는 필드: {{{{{key}}}}}")
            v = None
        return apply_filters(v, filters)

    def render_text(text: str, item: dict | None, idx: int | None, is_date: bool, cell):
        exprs = PH.findall(text)
        whole = PH.fullmatch(text.strip()) is not None and len(exprs) == 1

        def val(expr):
            kind, key, lim, field, filters = parse_expr(expr)
            if kind == "list":
                if item is None:
                    return None
                v = idx if field == "#" else item.get(field)
                return apply_filters(v, filters)
            return get_scalar(key, filters)

        if whole:
            _set_value(cell, val(exprs[0]), is_date)
        else:
            def sub(m):
                v = val(m.group(1))
                return "" if v is None else str(v)
            _set_text(cell, PH.sub(sub, text).replace("\\{{", "{{"))
        stats["values"] += len(exprs)

    for sname, path in b.sheets:
        if path not in b.files:
            continue
        sh = b.load(path)
        sd = sh.find(X + "sheetData")
        if sd is None:
            continue
        rels = b.sheet_rels(path)
        tables = []
        tp = sh.find(X + "tableParts")
        if tp is not None:
            for t in tp.findall(X + "tablePart"):
                rel = rels.get(t.get(f"{{{R}}}id"))
                if rel and rel[1] in b.files:
                    tables.append(b.load(rel[1]))
        merges = sh.find(X + "mergeCells")
        rows = {int(r.get("r")): r for r in sd.findall(X + "row")}
        occupied = {n for n, r in rows.items() if any(b.cell_text(c) is not None or c.find(X + "v") is not None or c.find(X + "f") is not None for c in r)}
        max_row_written = 0
        for rn in sorted(rows):
            row = rows[rn]
            cells = list(row.findall(X + "c"))
            texts = {c.get("r"): b.cell_text(c) for c in cells}
            lists_in_row = []
            for t in texts.values():
                for expr in PH.findall(t or ""):
                    k = parse_expr(expr)
                    if k[0] == "list":
                        lists_in_row.append((k[1], k[2]))
            if not lists_in_row:
                for c in cells:
                    t = texts[c.get("r")]
                    if t and (PH.search(t) or "\\{{" in t):
                        render_text(t, None, None, int(c.get("s", "0")) in b.date_styles, c)
                continue
            lname, limit = lists_in_row[0]
            if len({x[0] for x in lists_in_row}) > 1:
                warnings.append(f"[{sname}] {rn}행에 서로 다른 목록이 섞여 있어 '{lname}' 기준으로 채웠습니다.")
            try:
                items = ctx.items(lname)
            except KeyError:
                items = []
            if limit:
                items = items[:limit]
            # 채울 수 있는 행 수: 아래쪽 연속 빈 행
            cap = 1
            while rn + cap not in occupied and rn + cap <= 1048576 and cap < len(items):
                cap += 1
            if len(items) > cap:
                warnings.append(f"[{sname}] '{lname}' {len(items)}건 중 {cap}건만 채웠습니다 ({rn + cap}행에 다른 내용이 있음). 양식에 빈 행을 더 두세요.")
                items = items[:cap]
            if not items:
                for c in cells:
                    t = texts[c.get("r")]
                    if t and PH.search(t):
                        _clear(c)
                continue
            for i, item in enumerate(items):
                target = rn + i
                if i == 0:
                    trow = row
                else:
                    trow = rows.get(target)
                    if trow is None:
                        trow = etree.Element(X + "row")
                        trow.set("r", str(target))
                        after = max([k for k in rows if k < target], default=None)
                        if after is None:
                            sd.insert(0, trow)
                        else:
                            rows[after].addnext(trow)
                        rows[target] = trow
                    for a in ("ht", "customHeight", "s", "customFormat"):
                        if row.get(a) is not None:
                            trow.set(a, row.get(a))
                for c in cells:
                    col, _ = split_ref(c.get("r"))
                    if i == 0:
                        tc = c
                    else:
                        tc = next((x for x in trow.findall(X + "c") if x.get("r") == f"{col}{target}"), None)
                        if tc is None:
                            tc = etree.Element(X + "c")
                            tc.set("r", f"{col}{target}")
                            nxt = next((x for x in trow.findall(X + "c") if col2n(split_ref(x.get("r"))[0]) > col2n(col)), None)
                            if nxt is not None:
                                nxt.addprevious(tc)
                            else:
                                trow.append(tc)
                        if c.get("s"):
                            tc.set("s", c.get("s"))
                    t = texts[c.get("r")]
                    if t and PH.search(t):
                        render_text(t, item, i + 1, int(c.get("s", "0")) in b.date_styles, tc)
                    elif i > 0:
                        f = c.find(X + "f")
                        _clear(tc)
                        if f is not None and f.text:
                            nf = etree.SubElement(tc, X + "f")
                            nf.text = shift_formula(f.text, rn, i)
                        elif c.find(X + "v") is not None:
                            if c.get("t"):
                                tc.set("t", c.get("t"))
                            etree.SubElement(tc, X + "v").text = c.find(X + "v").text
                    elif c.find(X + "f") is not None:
                        v = c.find(X + "v")
                        if v is not None:
                            c.remove(v)
                occupied.add(target)
            n = len(items)
            stats["rows"] += n
            max_row_written = max(max_row_written, rn + n - 1)
            last = rn + n - 1
            # 병합 셀 복제
            if merges is not None and n > 1:
                for mc in list(merges.findall(X + "mergeCell")):
                    a, _, bb = mc.get("ref").partition(":")
                    (ca, ra), (cb, rb) = split_ref(a), split_ref(bb or a)
                    if ra == rb == rn:
                        for k in range(1, n):
                            e = etree.SubElement(merges, X + "mergeCell")
                            e.set("ref", f"{ca}{rn + k}:{cb}{rn + k}")
                merges.set("count", str(len(merges.findall(X + "mergeCell"))))
            # 표(Excel Table) 범위 확장
            for tb in tables:
                a, _, bb = tb.get("ref").partition(":")
                (ca, ra), (cb, rb) = split_ref(a), split_ref(bb)
                if ra < rn <= rb and last > rb:
                    tb.set("ref", f"{ca}{ra}:{cb}{last}")
                    af = tb.find(X + "autoFilter")
                    if af is not None:
                        af.set("ref", f"{ca}{ra}:{cb}{last}")
            # 조건부 서식·데이터 유효성: 템플릿 행 한 줄 범위면 확장
            for el in list(sh.iter(X + "conditionalFormatting")) + list(sh.iter(X + "dataValidation")):
                sq = el.get("sqref") or ""
                new = []
                for part in sq.split():
                    a, _, bb = part.partition(":")
                    try:
                        (ca, ra), (cb, rb) = split_ref(a), split_ref(bb or a)
                    except AttributeError:
                        new.append(part)
                        continue
                    new.append(f"{ca}{ra}:{cb}{last}" if ra == rb == rn else part)
                el.set("sqref", " ".join(new))
        # 머리글/바닥글
        hf = sh.find(X + "headerFooter")
        if hf is not None:
            for el in hf:
                if el.text and PH.search(el.text):
                    el.text = PH.sub(lambda m: str(get_scalar(parse_expr(m.group(1))[1], parse_expr(m.group(1))[4]) or ""), el.text)
        dim = sh.find(X + "dimension")
        if dim is not None and max_row_written:
            a, _, bb = dim.get("ref").partition(":")
            if bb:
                cb, rb = split_ref(bb)
                if max_row_written > rb:
                    dim.set("ref", f"{a}:{cb}{max_row_written}")
        for r in sd.findall(X + "row"):
            r.attrib.pop("spans", None)

    # 열 때 전체 재계산 (차트·수식 갱신), 오래된 계산 체인 제거
    wb = b.load("xl/workbook.xml")
    cp = wb.find(X + "calcPr")
    if cp is None:
        cp = etree.SubElement(wb, X + "calcPr")
    cp.set("fullCalcOnLoad", "1")
    if "xl/calcChain.xml" in b.files:
        b.removed.add("xl/calcChain.xml")
        rels = b.load("xl/_rels/workbook.xml.rels")
        for r in list(rels):
            if (r.get("Target") or "").endswith("calcChain.xml"):
                rels.remove(r)
        ct = b.load("[Content_Types].xml")
        for o in list(ct):
            if (o.get("PartName") or "").endswith("calcChain.xml"):
                ct.remove(o)
    seen = set()
    warnings = [w for w in warnings if not (w in seen or seen.add(w))]
    return b.save(), warnings, stats
