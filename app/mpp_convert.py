"""MS Project 바이너리(.mpp/.mpt) 및 기타 형식(.mpx, P6 XML 등)을 MSPDI XML 로 변환.

MPXJ(https://www.mpxj.org, LGPL) 의 UniversalProjectReader 를 사용한다. JVM 을 쓰므로
웹 서버 프로세스와 분리하기 위해 별도 프로세스로 실행한다.

    python -m app.mpp_convert <입력 파일> <출력 XML>
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

TIMEOUT = int(os.environ.get("MPP_TIMEOUT", "120"))


def available() -> bool:
    try:
        import jpype  # noqa: F401
        import mpxj  # noqa: F401
    except ImportError:
        return False
    from shutil import which
    return bool(which("java") or os.environ.get("JAVA_HOME"))


def convert(raw: bytes, suffix: str) -> bytes:
    """바이트 → MSPDI XML 바이트. 실패하면 ValueError."""
    if not available():
        raise ValueError("이 서버에는 MS Project 바이너리 변환기(Java + mpxj)가 설치되어 있지 않습니다. "
                         "MS Project에서 'XML 형식(*.xml)'으로 저장해 올려 주세요.")
    with tempfile.TemporaryDirectory(prefix="mpp-") as d:
        src = os.path.join(d, "in" + suffix)
        dst = os.path.join(d, "out.xml")
        with open(src, "wb") as f:
            f.write(raw)
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env = {**os.environ, "PYTHONPATH": root, "_JAVA_OPTIONS": "-Xmx768m"}
        try:
            p = subprocess.run([sys.executable, "-m", "app.mpp_convert", src, dst], capture_output=True,
                               text=True, timeout=TIMEOUT, cwd=d, env=env)
        except subprocess.TimeoutExpired:
            raise ValueError("파일 변환 시간이 초과되었습니다")
        if p.returncode != 0 or not os.path.exists(dst):
            msg = (p.stderr or p.stdout or "").strip().splitlines()
            raise ValueError("MS Project 파일을 읽을 수 없습니다: " + (msg[-1][:200] if msg else "알 수 없는 오류"))
        with open(dst, "rb") as f:
            return f.read()


def _main(src: str, dst: str) -> None:
    import jpype
    import mpxj  # noqa: F401  (MPXJ jar 를 클래스패스에 등록)
    jpype.startJVM()
    from org.mpxj.mspdi import MSPDIWriter
    from org.mpxj.reader import UniversalProjectReader
    project = UniversalProjectReader().read(src)
    if project is None:
        raise SystemExit("지원하지 않는 파일 형식입니다")
    MSPDIWriter().write(project, dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("사용법: python -m app.mpp_convert <입력> <출력.xml>")
    _main(sys.argv[1], sys.argv[2])
