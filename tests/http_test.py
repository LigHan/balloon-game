"""Exercise the real Java HTTP server using only Python's standard library."""
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:18081"
checks = 0


def check(value, name):
    global checks
    checks += 1
    assert value, name


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def request(self, path, body=None, expect=200, headers=None):
        extra = {}
        data = None
        if body is not None:
            extra = {"Content-Type": "application/json", "X-CSRF-Token": self.csrf}
            data = json.dumps(body).encode()
        extra.update(headers or {})
        request = urllib.request.Request(BASE + path, data=data, headers=extra)
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        payload = json.loads(response.read())
        check(response.code == expect, f"{path}: expected {expect}, got {response.code}: {payload}")
        return payload

    def state(self):
        state = self.request("/api/state")
        self.csrf = state["csrf"]
        return state

    def scenario(self, value):
        self.request("/api/admin/scenario", {"scenario": value})

    def start(self, tier=0, theme="green", key=None):
        return self.request("/api/rounds", {"theme": theme, "tier": tier, "requestId": key or str(uuid.uuid4())})

    def until(self, condition):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            current = self.state()
            if condition(current):
                return current
            time.sleep(.04)
        raise AssertionError("Timed out waiting for expected state")


java_home = os.environ.get("JAVA_HOME")
java = str(Path(java_home) / "bin/java") if java_home else shutil.which("java")
bundled = Path("/Applications/PyCharm CE.app/Contents/jbr/Contents/Home/bin/java")
if not java_home and bundled.exists():
    java = str(bundled)

with tempfile.TemporaryDirectory(prefix="balloon-http-") as temp:
    temp = Path(temp)
    cfg = json.loads((ROOT / "config/game.json").read_text())
    for theme in ["green", "red"]:
        cfg[theme]["multiplier_growth_rate"] = 1
    config_path = temp / "game.json"
    config_path.write_text(json.dumps(cfg))
    environment = dict(os.environ, HOST="127.0.0.1", PORT="18081", GAME_CONFIG=str(config_path), GAME_DATA=str(temp / "data"), GAME_DEV_MODE="1", GAME_DEV_SEED="http-suite", ADMIN_PASSWORD="test-admin-only")

    def launch():
        return subprocess.Popen([java, "--add-modules", "jdk.httpserver", "-cp", "build", "balloon.Server"], cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    process = launch()
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode())
            try:
                urllib.request.urlopen(BASE + "/health", timeout=.5)
                break
            except urllib.error.URLError:
                time.sleep(.1)
        client, other = Client(), Client()
        initial = client.state()
        check(initial["player"]["balance"] == 1000, "Nonzero demo balance")
        check(any(c.name == "balloon_sid" for c in client.jar), "Identity cookie created")
        for route in ["/", "/admin", "/presentation", "/style.css", "/ui.css", "/sky-scene.css", "/app.js", "/request-id.js", "/ui.js", "/sky-scene.js", "/admin.js", "/presentation.js", "/assets/balloon.png", "/assets/cloud.svg", "/assets/village.svg", "/assets/stoloto-logo.png", "/assets/roboto-flex.woff2", "/assets/favicon.svg"]:
            response = urllib.request.urlopen(BASE + route)
            check(response.status == 200 and len(response.read()) > 0, "Static route: " + route)
            check(response.headers.get("X-Content-Type-Options") == "nosniff", "Security header: " + route)
            if route.endswith(".woff2"):
                check(response.headers.get_content_type() == "font/woff2", "Correct font MIME type")
        client.request("/api/admin/config", expect=401)
        client.request("/api/profile", {"name": "test"}, expect=403, headers={"X-CSRF-Token": "wrong"})
        client.request("/api/profile", {"name": "test"}, expect=403, headers={"Origin": "https://example.invalid"})
        client.request("/api/rounds", {"theme": "green", "tier": 0, "requestId": str(uuid.uuid4()), "multiplier": 999}, expect=400)
        client.request("/api/admin/login", {"password": "wrong"}, expect=401)
        client.request("/api/admin/login", {"password": "test-admin-only"})
        client.request("/api/profile", {"name": "HTTP pilot"})

        # Full winning path and concurrent, idempotent cashout.
        client.scenario("cashout")
        key = str(uuid.uuid4())
        started = client.start(tier=1, key=key)
        check(client.start(tier=1, key=key)["id"] == started["id"], "HTTP start idempotency")
        check("proof" not in started and "crashBase" not in started, "No secret result in initial response")
        client.request(f"/api/rounds/{started['id']}/cashout", {}, expect=400)
        client.until(lambda s: s["round"]["highestLine"] >= 1)
        other.state()
        other.request(f"/api/rounds/{started['id']}/cashout", {}, expect=400)
        client.request(f"/api/rounds/{started['id']}/cashout", {"multiplier": 999}, expect=400)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            responses = list(executor.map(lambda _: client.request(f"/api/rounds/{started['id']}/cashout", {}), range(12)))
        check(len({r["payout"] for r in responses}) == 1, "Concurrent HTTP cashouts agree")
        in_flight = client.state()
        check(in_flight["round"]["status"] == "flying", "Flight continues after cashout over HTTP")
        check(in_flight["player"]["balance"] == 975 + responses[0]["payout"], "Exactly one HTTP cashout credit")
        finished = client.until(lambda s: s["round"]["status"] == "finished")
        proof = client.request(f"/api/rounds/{started['id']}/proof")
        check(hashlib.sha256(proof["proof"].encode()).hexdigest() == started["commitment"], "Browser-compatible SHA-256 proof")
        check(finished["round"]["reward"] is not None, "Winning result includes reward")
        check(other.state()["history"][0]["name"] == "HTTP pilot", "Shared history across independent sessions")

        # Guaranteed booster, then loss after completed lines.
        client.scenario("booster")
        client.start(tier=2)
        boosted = client.until(lambda s: s["round"]["boosterActivated"])
        check(boosted["round"]["multiplier"] >= 4.92, "×3 booster changes server multiplier")
        check(boosted["round"]["points"] == 70, "Booster and line points")
        lost = client.until(lambda s: s["round"]["status"] == "finished")
        check(lost["round"]["cashoutMultiplier"] is None and lost["round"]["points"] > 0, "Loss preserves earned points")
        client.scenario("crash")
        early = client.start(theme="red")
        lost = client.until(lambda s: s["round"]["status"] == "finished")
        check(lost["round"]["highestLine"] == 0 and lost["round"]["reward"] is not None, "Early red crash and reward")

        # Hot configuration and durable active state across process restart.
        cfg["points_per_line"] = 37
        client.request("/api/admin/config", cfg)
        client.scenario("cashout")
        restart_round = client.start()
        level = client.until(lambda s: s["round"]["highestLine"] == 1)
        check(level["round"]["points"] == 37, "New point configuration applied")
        process.terminate()
        process.wait(timeout=5)
        process = launch()
        time.sleep(.4)
        recovered = client.state()
        check(recovered["round"]["id"] == restart_round["id"], "Session and active round survive restart")
        final = client.until(lambda s: s["round"]["status"] == "finished")
        check(final["round"]["points"] % 37 == 0, "Recovered points follow round snapshot")
        client.request("/api/admin/config", expect=401)
        client.request("/api/admin/login", {"password": "test-admin-only"})
        invalid = json.loads(json.dumps(cfg))
        invalid["green"]["loot_weights"] = [0] * 9
        client.request("/api/admin/config", invalid, expect=400)
        check(client.request("/api/admin/config")["config"]["green"]["loot_weights"] == cfg["green"]["loot_weights"], "Invalid config does not replace valid settings")
        for request_path in ["/config/game.json", "/data/state.json", "/src/balloon/Server.java", "/../config/game.json"]:
            client.request(request_path, expect=404)
        print(f"PASS: {checks} HTTP assertions, isolated data and config, all mandatory scenarios")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
