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

## AI·의사결정 기능

계산은 CPM 엔진이 맡고, AI는 엔진 결과를 **도구로 조회해 해석·정리**합니다. 날짜와 일수는 항상 엔진 계산값이고, 원본 공정표를 바꾸는 작업은 사용자가 승인한 것만 반영합니다.
AI 키가 없으면 ①을 제외한 모든 기능이 규칙·통계 기반으로 동작합니다.

| # | 화면 | 기능 | AI 없이 |
|---|---|---|---|
| ① | AI 어시스턴트 | 자연어 질의. AI가 검색, 주공정, DCMA, 지연분석, What-if, 리스크 도구를 호출해 답하고, 답변의 작업을 공정표에서 강조 | 사용 불가 |
| ② | 월간 보고서 | 지연 원인, 주공정, 향후 1개월, 리스크로 보고서 초안 작성. 화면에서 수정 후 Word(.docx) 다운로드 | 템플릿 문장 |
| ③ | DCMA 14 점검 | 항목별 조치 가이드와 AI 우선순위 조치안 | 규칙 가이드 |
| ④ | 지연 원인 | 이전 업데이트 대비 최장 경로를 따라 작업별 **새로 발생한 지연**(기여도) 산정 | 동일 |
| ⑤ | What-if | 공기, 관계, Lag, 진도를 바꿔 재계산. 시나리오 저장과 **수정 XER 다운로드**(P6로 가져오기) | 동일 |
| ⑥ | 관계 추천 | Open End 작업의 누락 관계 추천, What-if 검증 후 XER 반영 | 규칙 추천 |
| ⑦ | 공종 분류 | 표준 공종 분류와 명칭 표준화 | 키워드 규칙 |
| ⑧ | 리스크 | 몬테카를로 P50/P80/P90 준공일, 목표 달성 확률, 주공정 지수 | 동일 |
| ⑨ | 리스크 | 지연 위험 점수(여유, 최장경로, 계획 대비, 진도 부진, 공종 실적, 업데이트 간 순연 추세) | 동일 |
| ⑩ | 벤치마크 | 팀 전체 프로젝트의 공종별 실적/계획 공기 비율, 과소 계획 의심 작업 | 동일 |
| ⑪ | 작업일보 진도 | 작업일보 문장에서 착수·완료·공정률을 추출해 진도 입력안 생성, 확인 후 XER 반영 | 정규식 추출 |

### AI 설정 (환경변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (없음) | Claude API 키. 없으면 AI 기능이 꺼지고 규칙 기반으로 동작 |
| `AI_PROVIDER` | `anthropic` | `bedrock`이면 AWS Bedrock(`AWS_REGION`, 예: ap-northeast-2) 경유, `off`면 AI 끔 |
| `AI_MODEL` | `claude-opus-5-5` | 대화와 보고서 작성 모델 |
| `AI_MODEL_BULK` | `AI_MODEL`과 같음 | 대량 분류·추출 모델. 비용을 줄이려면 `claude-haiku-5-5` 등 지정 |
| `AI_FALLBACKS` | `on` | 안전 분류기가 응답을 거절하면 서버 측 대체 모델로 자동 재시도(Anthropic API 직접 연결 시) |

- 공정 데이터(액티비티명, 날짜 등)가 AI 서비스로 전송됩니다. 발주처 계약상 외부 전송이 제한되면 국내 리전 Bedrock을 쓰거나 `AI_PROVIDER=off`로 두세요.
- AI 호출 기록(기능, 사용자, 토큰 수)은 `ai_log` 테이블에 남고 `/api/ai/status`에서 집계를 볼 수 있습니다.

### CPM 엔진 지원 범위
- FS / SS / FF / SF 관계, 양수·음수 Lag(선행 액티비티 캘린더 기준)
- 액티비티별 캘린더: 작업 요일과 예외일(공휴일) 반영, 일 단위 계산
- 진도 반영: 완료는 실적일 고정, 진행중은 Data Date부터 잔여공기, 미착수는 Data Date 이후로만 일정 배치. 순서 역전 진도는 Retained Logic으로 처리
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
APP_TOKEN=팀비밀번호 ANTHROPIC_API_KEY=sk-ant-... docker compose up -d --build
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
app/insights.py     규칙·통계 분석 (공종 분류, 관계 추천, 지연 기여도, 몬테카를로, 위험 점수, 벤치마크)
app/changes.py      변경안 적용 (What-if, 관계 추천, 진도 입력 공통)
app/ai.py           Claude API 연결 (도구 호출 루프, 구조화 출력, 거절 처리)
app/services.py     기능 서비스 계층 (①~⑪)
app/storage.py      SQLite 공유 저장소
app/main.py         FastAPI REST API
static/             웹 화면(바닐라 JS, 빌드 불필요)
samples/            데모 XER 생성기와 샘플 파일
```
