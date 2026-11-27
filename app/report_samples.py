"""기본 제공 엑셀 리포트 양식(예시) 생성 - openpyxl 로 새로 만든다.

사용자는 이 파일을 내려받아 회사 양식에 맞게 고치거나, 자기 양식에 자리표시자만 넣어 올리면 된다.
"""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.table import Table, TableStyleInfo

HEAD = PatternFill("solid", fgColor="1F2937")
SOFT = PatternFill("solid", fgColor="EEF2F7")
WHITE_B = Font(bold=True, color="FFFFFF")
B = Font(bold=True)
THIN = Side(style="thin", color="D1D5DB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
DATE = "yyyy-mm-dd"


def _title(ws, text, sub="{{project.name}} · Data Date {{project.data_date}}"):
    ws["A1"] = text
    ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = sub
    ws["A2"].font = Font(color="6B7280")


def _table(ws, row, headers, fields, list_name, widths=None, date_cols=(), name=None):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill, c.font, c.border = HEAD, WHITE_B, BOX
        c.alignment = Alignment(horizontal="center")
    for i, f in enumerate(fields, start=1):
        c = ws.cell(row=row + 1, column=i, value="{{%s.%s}}" % (list_name, f))
        c.border = BOX
        if f in date_cols:
            c.number_format = DATE
    for i, w in enumerate(widths or [], start=1):
        ws.column_dimensions[chr(64 + i)].width = w
    if name:
        t = Table(displayName=name, ref=f"A{row}:{chr(64 + len(headers))}{row + 1}")
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
        ws.add_table(t)


def monthly_template() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "요약"
    _title(ws, "월간 공정관리 보고 ({{report.month}})")
    rows = [("예상 준공일", "{{project.finish}}", "목표 준공일", "{{project.must_finish}}"),
            ("목표 대비 여유(일)", "{{project.margin_days}}", "직전 대비 준공 변동(일)", "{{prev.finish_slip}}"),
            ("공정률(%)", "{{project.progress_pct}}", "직전 공정률(%)", "{{prev.progress_pct}}"),
            ("베이스라인 준공일", "{{baseline.finish}}", "베이스라인 대비 편차(일)", "{{baseline.variance_days}}"),
            ("SPI", "{{evm.spi}}", "CPI", "{{evm.cpi}}"),
            ("건전성 점수", "{{health.score}}", "DCMA 통과(/14)", "{{dcma.pass}}"),
            ("완료 / 진행 / 미착수", "{{project.completed}} / {{project.in_progress}} / {{project.not_started}}", "최장경로 작업 수", "{{project.longest_count}}"),
            ("열린 리스크", "{{risk.open_count}}", "미해결 제약 / 기한 초과", "{{constraint.open_count}} / {{constraint.overdue_count}}")]
    for i, (a, b, c, d) in enumerate(rows, start=4):
        for col, v in zip("ABCD", (a, b, c, d)):
            cell = ws[f"{col}{i}"]
            cell.value = v
            cell.border = BOX
            if col in "AC":
                cell.fill, cell.font = SOFT, B
        for col in "BD":
            if any(k in ws[f"{col}{i}"].value for k in ("finish}}", "must_finish}}")):
                ws[f"{col}{i}"].number_format = DATE
    ws["A13"] = "핵심 메시지"
    ws["A13"].font = B
    ws["A14"] = "{{summary.headline}}"
    ws["A15"] = "{{summary.text}}"
    ws["A17"] = "지연 원인"
    ws["A17"].font = B
    ws["A18"] = "{{summary.delay_causes}}"
    ws["A20"] = "향후 1개월 주요 작업"
    ws["A20"].font = B
    ws["A21"] = "{{summary.next_month}}"
    for r in (14, 15, 18, 21):
        ws.merge_cells(f"A{r}:D{r}")
        ws[f"A{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 60 if r != 14 else 22
    for col, w in zip("ABCD", (24, 30, 26, 30)):
        ws.column_dimensions[col].width = w
    ws.oddHeader.center.text = "{{project.name}} 월간 공정보고"
    ws.oddFooter.right.text = "작성일 {{report.date}}"

    ws2 = wb.create_sheet("WBS 진척")
    _title(ws2, "WBS별 진척")
    _table(ws2, 4, ["WBS", "작업 수", "공정률(%)", "시작", "종료(예상)", "계획 종료", "편차(일)", "최장경로"],
           ["name", "activities", "progress_pct", "start", "finish", "bl_finish", "finish_var", "critical"], "wbs",
           [28, 9, 10, 12, 12, 12, 9, 9], {"start", "finish", "bl_finish"}, "WBS진척")

    ws3 = wb.create_sheet("주공정")
    _title(ws3, "최장경로(주공정) 작업")
    _table(ws3, 4, ["No", "ID", "작업명", "WBS", "잔여(일)", "시작", "종료", "TF"],
           ["#", "code", "name", "wbs", "rem_dur", "start", "finish", "tf"], "critical", [5, 10, 30, 22, 9, 12, 12, 6], {"start", "finish"}, "주공정")

    ws4 = wb.create_sheet("지연·변경")
    _title(ws4, "지연 원인과 계획 대비 지연 작업")
    _table(ws4, 4, ["ID", "작업명", "종료 순연(일)", "새로 발생(일)", "추정 원인"], ["code", "name", "slip", "introduced", "note"],
           "delay_top[15]", [10, 30, 12, 12, 40])
    ws4["A22"] = "계획(베이스라인) 대비 지연 작업"
    ws4["A22"].font = B
    _table(ws4, 23, ["ID", "작업명", "계획 종료", "예상 종료", "편차(일)"], ["code", "name", "bl_finish", "finish", "finish_var"],
           "late[30]", None, {"bl_finish", "finish"})

    ws5 = wb.create_sheet("향후 1개월")
    _title(ws5, "향후 30일 착수·완료 예정")
    _table(ws5, 4, ["ID", "작업명", "상태", "시작", "종료", "TF", "최장경로"], ["code", "name", "status", "start", "finish", "tf", "critical"],
           "lookahead", [10, 30, 9, 12, 12, 6, 9], {"start", "finish"}, "향후1개월")

    ws6 = wb.create_sheet("리스크·제약")
    _title(ws6, "리스크와 미해결 제약")
    _table(ws6, 4, ["리스크", "분류", "영향 작업", "확률(%)", "영향(일)", "노출도", "대응", "상태"],
           ["title", "category", "codes", "prob", "impact_ml", "exposure_days", "mitigation", "status"], "risks[20]",
           [28, 10, 14, 8, 8, 8, 28, 8])
    ws6["A27"] = "미해결 제약"
    ws6["A27"].font = B
    _table(ws6, 28, ["ID", "유형", "내용", "담당", "기한", "상태"], ["code", "type", "desc", "owner", "due", "status"], "constraints")

    ws7 = wb.create_sheet("S커브")
    _title(ws7, "S-Curve (원공기 가중 누적 공정률 %)")
    _table(ws7, 4, ["날짜", "계획", "Early", "Late"], ["date", "baseline", "early", "late"], "scurve", [12, 10, 10, 10], {"date"})
    ch = LineChart()
    ch.title = "S-Curve"
    ch.y_axis.title = "%"
    ch.height, ch.width = 9, 18
    data = Reference(ws7, min_col=2, min_row=4, max_col=4, max_row=130)
    ch.add_data(data, titles_from_data=True)
    ch.set_categories(Reference(ws7, min_col=1, min_row=5, max_row=130))
    ws7.add_chart(ch, "F4")

    ws8 = wb.create_sheet("작성 안내")
    guide = ["이 양식은 예시입니다. 회사 양식에 아래 규칙으로 자리표시자를 넣어 올리면 됩니다.",
             "① 값: 셀에 \\{{project.finish}} 처럼 입력 → 값으로 바뀝니다. 셀 서식을 날짜로 두면 날짜 값으로 들어갑니다.",
             "② 표: 한 행에 \\{{critical.code}}, \\{{critical.name}} … 을 넣으면 항목 수만큼 아래로 채웁니다. 아래 행은 비워 두세요.",
             "   개수 제한: \\{{late[20].code}}  /  순번: \\{{critical.#}}",
             "③ 서식: \\{{project.finish|date:%Y.%m.%d}}  \\{{evm.spi|num:2}}  \\{{project.must_finish|default:-}}  \\{{project.progress_pct|pct}}(백분율 셀)",
             "④ 차트·수식·서식은 그대로 유지됩니다. 파일을 열면 수식이 다시 계산됩니다.",
             "⑤ 전체 필드 목록은 앱의 '엑셀 리포트' 화면 → '필드 목록'에서 확인하세요."]
    for i, t in enumerate(guide, start=1):
        ws8[f"A{i}"] = t
    ws8.column_dimensions["A"].width = 120
    for w in wb.worksheets:  # 인쇄: A4 가로, 한 페이지 너비에 맞춤
        w.page_setup.orientation = "landscape"
        w.page_setup.paperSize = w.PAPERSIZE_A4
        w.sheet_properties.pageSetUpPr.fitToPage = True
        w.page_setup.fitToWidth, w.page_setup.fitToHeight = 1, 0
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


BUILTIN = {"monthly": ("기본 월간 공정보고 (예시)", "요약·WBS 진척·주공정·지연·향후 1개월·리스크·S커브 8개 시트", monthly_template)}
