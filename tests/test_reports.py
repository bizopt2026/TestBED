import io
import json
import os
import sys
import tempfile
import zipfile
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(__file__))

import openpyxl  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openpyxl.worksheet.table import Table  # noqa: E402

from app import ai, services, storage  # noqa: E402
from app.main import app  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SAMPLE = os.path.join(ROOT, "samples", "sample_project.xer")


@pytest.fixture
def client():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "r.db")
    storage.init()
    services._tables.cache_clear()
    ai.PROVIDER = "off"
    yield TestClient(app)
    ai.PROVIDER = "cli"


def up(c, raw):
    return c.post("/api/upload", files={"file": ("s.xer", raw)}).json()["ids"][0]


def two(c):
    raw = open(SAMPLE, "rb").read()
    up(c, raw)
    return up(c, raw.decode().replace("\t2026-03-02 08:00\tY", "\t2026-04-01 08:00\tY").encode())


def custom_template() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "보고"
    ws["A1"] = "{{project.name}} 보고 ({{project.data_date|date:%Y.%m.%d}})"
    ws["B2"] = "{{project.finish}}"
    ws["B2"].number_format = "yyyy-mm-dd"
    ws["C2"] = "{{project.finish}}"            # 일반 서식 → 문자열
    ws["B3"] = "{{evm.spi|num:1}}"
    ws["B4"] = "{{prev.finish_slip}}"
    ws["B5"] = "{{nope.unknown}}"
    ws["B6"] = r"\{{literal}}"
    ws["A8"], ws["B8"], ws["C8"], ws["D8"] = "No", "ID", "종료", "TF×2"
    ws["A9"], ws["B9"], ws["C9"], ws["D9"] = "{{critical.#}}", "{{critical.code}}", "{{critical.finish}}", "=E9*2"
    ws["E9"] = "{{critical.tf}}"
    ws.add_table(Table(displayName="CP", ref="A8:E9"))
    ws["A12"] = "{{late[3].code}}"
    ws["A14"] = "막힘"                            # 13행까지만 채울 수 있음 → 경고
    ws["A16"] = "{{milestones.name}}"
    ws.merge_cells("A16:B16")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_custom_template_render(client):
    uid = two(client)
    r = client.post("/api/reports/templates", files={"file": ("my.xlsx", custom_template())}, data={"name": "내 양식"}).json()
    assert r["scan"]["unknown"][0]["expr"] == "nope.unknown" and "critical" in r["scan"]["lists"]
    tid = r["id"]
    assert any(t["id"] == tid for t in client.get("/api/reports/templates").json())
    res = client.post("/api/reports/render", json={"template_id": tid, "upload_id": uid})
    assert res.status_code == 200
    warns = json.loads(unquote(res.headers["x-report-warnings"]))
    assert any("nope.unknown" in w for w in warns)
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws = wb["보고"]
    assert ws["A1"].value == "SAMPLE-물류센터 신축공사 보고 (2026.04.01)"
    assert ws["B2"].value.date().isoformat() == "2026-09-25" and ws["C2"].value == "2026-09-25"
    assert ws["B4"].value == 30 and ws["B6"].value == "{{literal}}" and ws["B5"].value is None
    assert ws["A9"].value == 1 and ws["B9"].value == "A2000" and ws["B10"].value == "A2010"
    assert ws["D10"].value == "=E10*2"
    n = sum(1 for r_ in range(9, 40) if ws[f"B{r_}"].value)
    assert ws.tables["CP"].ref == f"A8:E{8 + n}"
    assert ws["A12"].value and ws["A13"].value and ws["A14"].value == "막힘"   # late[3] 중 2건만 들어감
    assert any("'late'" in w and "2건만" in w for w in warns)
    assert "A17:B17" in [str(m) for m in ws.merged_cells.ranges]
    z = zipfile.ZipFile(io.BytesIO(res.content))
    assert b'fullCalcOnLoad="1"' in z.read("xl/workbook.xml")
    hist = client.get("/api/reports/history").json()
    assert hist[0]["template"] == "내 양식"


def test_builtin_template_and_fields(client):
    uid = two(client)
    t = client.get("/api/reports/templates").json()[0]
    assert t["builtin"]
    assert client.get(f"/api/reports/templates/{t['id']}/file").content[:2] == b"PK"
    res = client.post("/api/reports/render", json={"template_id": t["id"], "upload_id": uid})
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert wb["주공정"]["B5"].value == "A2000"
    assert "charts" in " ".join(zipfile.ZipFile(io.BytesIO(res.content)).namelist())
    f = client.get("/api/reports/fields").json()
    assert any(x["key"] == "evm.spi" for x in f["scalars"]) and any(x["name"] == "critical" for x in f["lists"])


def test_template_security(client):
    up(client, open(SAMPLE, "rb").read())
    assert client.post("/api/reports/templates", files={"file": ("a.xlsx", b"not zip")}).status_code == 400
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/vbaProject.bin", b"x")
    r = client.post("/api/reports/templates", files={"file": ("m.xlsx", buf.getvalue())})
    assert r.status_code == 400 and "매크로" in r.json()["detail"]
    assert client.post("/api/reports/templates", files={"file": ("m.xlsm", custom_template())}).status_code == 400
    xxe = io.BytesIO()
    with zipfile.ZipFile(xxe, "w") as z:
        z.writestr("xl/workbook.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><workbook>&e;</workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'/>")
    r = client.post("/api/reports/templates", files={"file": ("x.xlsx", xxe.getvalue())})
    assert r.status_code in (200, 400) and "root:" not in r.text
