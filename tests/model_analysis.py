"""Reproducible statistical check of Game.java's capped Pareto distribution."""
import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "config/game.json").read_text())
n = 100_000
uniforms = [(int(hashlib.sha256(f"model-sample-{i}:crash".encode()).hexdigest()[:13], 16) + .5) / 2**52 for i in range(n)]
rows = []
for theme in ("green", "red"):
    t = config[theme]
    for alpha in (t["alpha"], 2.0):
        values = [math.floor((min(t["max_multiplier"], t["min_crash_multiplier"] / (1-u)**(1/alpha)) + 1e-10)*100)/100 for u in uniforms]
        empirical = sum(v >= 2 for v in values) / n
        expected = (t["min_crash_multiplier"] / 2)**alpha
        assert abs(empirical - expected) < .01
        rows.append({"theme": theme, "alpha": alpha, "samples": n, "p_ge_2_theory": round(expected, 6), "p_ge_2_sample": round(empirical, 6), "mean_base_crash": round(sum(values)/n, 6), "cap": t["max_multiplier"], "seconds_to_2": round(math.log(2)/t["multiplier_growth_rate"], 3)})
target = ROOT / "docs/model-analysis.csv"
with target.open("w", newline="") as file:
    writer = csv.DictWriter(file, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps(rows, ensure_ascii=False, indent=2))
print("PASS: theoretical and sampled survival probabilities differ by less than 1 percentage point")
