# 공정관리 분석기 (XER 기반)

Primavera P6에서 내보낸 **XER 파일을 업로드하면 공정표를 다시 계산(CPM)하고 분석**하는 팀 공유 웹앱입니다.
업로드한 결과는 서버에 저장되어 팀원 모두가 같은 화면을 봅니다.

## 주요 기능

| 화면 | 내용 |
|---|---|
| 목록 | 팀이 올린 XER 목록(업로더·메모·Data Date), 원본 XER 다운로드, 삭제 |
| 개요 | 예상 준공일, 목표 준공일, 잔여 작업일, 공정률, 상태별 개수, 주공정 수, DCMA 통과 수, 마일스톤 |
| 공정표 | WBS별 간트차트(일/주/월/분기 배율), 주공정 빨간색, 계획(Target) 막대, Total Float 꼬리, Data Date 선, 검색·필터, 클릭하면 선·후행 관계와 관계선 표시 |
| 주공정 | 최장 경로(Longest Path) 역추적, 준주공정(TF ≤ N일) |
| DCMA 14 점검 | Logic, Leads, Lags, 관계 유형, Hard Constraints, High Float, Negative Float, High Duration, Invalid Dates, Resources, Missed Tasks, CP Test, CPLI, BEI |
| S-Curve | 계획(Target), Early, Late 누적 곡선과 실적 공정률 |
| P6 일정 비교 | XER에 저장된 P6 계산값과 엔진 재계산값의 차이(검증용) |
| 업데이트 비교 | 두 업로드(예: 3월과 4월)의 준공일 변동, 추가·삭제·변경 액티비티 |
| 내보내기 | 액티비티 목록 CSV(엑셀 호환, UTF-8 BOM) |

### CPM 엔진 지원 범위
- FS / SS / FF / SF 관계, 양수·음수 Lag(선행 액티비티 캘린더 기준)
- 액티비티별 캘린더: 작업 요일과 예외일(공휴일) 반영, 일 단위 계산
- 진도 반영: 완료는 실적일 고정, 진행중은 Data Date부터 잔여공기, 미착수는 Data Date 이후로만 일정 배치
- 제약조건: Start/Finish On, On or After, On or Before, Mandatory Start/Finish
- 프로젝트 Must Finish By 날짜 기준 Total Float(음수 여유 포함), Free Float
- 순환 관계(Loop) 탐지와 경고

### 알려진 한계
- 계산 단위가 **일**입니다. 시간 단위로 계산하는 P6와 반나절 차이가 날 수 있습니다.
- Retained Logic만 지원합니다(Progress Override는 미지원). LOE와 WBS Summary는 일반 작업처럼 계산합니다.
- 자원 평준화와 비용(EVM)은 아직 없습니다.

## 실행 방법

### 로컬 개발
```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```
브라우저에서 http://localhost:8000 을 열고 `samples/sample_project.xer`를 업로드해 보세요.

### 팀 서버 배포 (Docker)
```bash
APP_TOKEN=팀비밀번호 docker compose up -d --build
```
- 데이터는 `./data/app.db`(SQLite)에 저장됩니다. 이 파일만 백업하면 됩니다.
- `APP_TOKEN`을 지정하면 처음 접속할 때 토큰을 묻습니다. 사내망 밖에 노출한다면 HTTPS 리버스 프록시(nginx 등)를 함께 쓰세요.

### 테스트
```bash
python -m pytest -q
```

## 구조
```
app/xer_parser.py   XER(탭 구분 텍스트) 파서, UTF-8/CP949 자동 판별
app/calendar.py     P6 캘린더(clndr_data) 해석, 작업일 연산
app/schedule.py     공정 모델과 CPM(Forward/Backward pass, Float, Longest Path)
app/analysis.py     DCMA 14, 요약, S-Curve, P6 비교
app/storage.py      SQLite 공유 저장소
app/main.py         FastAPI REST API
static/             웹 화면(바닐라 JS, 빌드 불필요)
samples/            데모 XER 생성기와 샘플 파일
```
