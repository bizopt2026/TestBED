"""대형 성능 시험용 XER 생성: python samples/make_large.py 10000 > big.xer"""
import random
import sys

sys.path.insert(0, ".")
from tests.helpers import build_xer  # noqa: E402

n = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
rng = random.Random(1)
tasks = [(f"A{i:05d}", rng.randint(1, 20)) for i in range(n)]
rels = []
for i in range(1, n):
    rels.append((tasks[max(0, i - rng.randint(1, 30))][0], tasks[i][0], "FS", 0))
    if rng.random() < 0.3:
        rels.append((tasks[max(0, i - rng.randint(1, 200))][0], tasks[i][0], rng.choice(["FS", "SS"]), rng.randint(0, 3)))
sys.stdout.buffer.write(build_xer(tasks, list({(a, b): (a, b, t, l) for a, b, t, l in rels}.values())))
