"""오늘 날짜. 테스트·화면 비교에서 날짜를 고정하려면 환경 변수 APP_TODAY=YYYY-MM-DD."""
import os
from datetime import date


def today() -> date:
    v = os.environ.get("APP_TODAY")
    return date.fromisoformat(v) if v else date.today()
