"""Portable local-only DAI bootstrap. Never uses a developer's backend/.env database."""

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local"
WIN = os.name == "nt"
NPM = shutil.which("npm.cmd" if WIN else "npm")
VENV = ROOT / "hospital_portal/.venv"
PY = VENV / ("Scripts/python.exe" if WIN else "bin/python")


def run(args, env=None, cwd=ROOT):
    subprocess.run([str(a) for a in args], cwd=cwd, env=env, check=True)


class LauncherBusy(RuntimeError):
    pass


@contextmanager
def workspace_lock(wait_timeout=0):
    """Use the OS lock, not file existence, to detect a running launcher."""
    STATE.mkdir(exist_ok=True)
    with (STATE / "run.lock").open("a+") as handle:
        if WIN:
            import msvcrt
            if handle.tell() == 0:
                handle.write(" ")
                handle.flush()
        else:
            import fcntl
        deadline = time.monotonic() + wait_timeout
        while True:
            try:
                if WIN:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (BlockingIOError, PermissionError):
                if time.monotonic() >= deadline:
                    if wait_timeout:
                        raise LauncherBusy(
                            "DAI has not finished stopping or setting up yet. Check the original DAI terminal, "
                            "press Ctrl+C there if needed, then run npm start again."
                        )
                    raise LauncherBusy(
                        "DAI is already running or being set up in this checkout. "
                        "Run npm run stop and wait for 'DAI stopped', then run npm start."
                    )
                time.sleep(0.1)
        try:
            yield
        finally:
            if WIN:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def stop_launcher(wait_timeout=60):
    STATE.mkdir(exist_ok=True)
    (STATE / "stop-request").touch()
    print("Stopping DAI; waiting for this checkout's services to exit...", flush=True)
    # The run command releases its lock only after its service cleanup completes.
    # Never unlink run.lock: that could let two launchers own different inodes.
    with workspace_lock(wait_timeout=wait_timeout):
        print("DAI stopped. Local data is preserved. You can run npm start now.", flush=True)


def config():
    STATE.mkdir(exist_ok=True)
    file = STATE / "config.json"
    if not file.exists():
        file.write_text(
            json.dumps(
                {
                    "jwt_secret": secrets.token_urlsafe(48),
                    "demo_password": "Dai-Synthetic-2026!",
                },
                indent=2,
            )
        )
        file.chmod(0o600)
    return json.loads(file.read_text())


def environment(cfg):
    env = os.environ.copy()
    port = int(env.get("DAI_PORT", "3001"))
    # Deliberately override inherited deployment credentials and production cookie flags.
    env.update(
        {
            "NODE_ENV": "development",
            "DAI_LOCAL": "true",
            "DAI_DEMO": "true",
            "PORT": str(port),
            "DAI_WEB_ORIGIN": f"http://localhost:{port}",
            "JWT_SECRET": cfg["jwt_secret"],
            "DAI_DEMO_PASSWORD": cfg["demo_password"],
            "DATABASE_URL": "sqlite:///" + str(STATE / "portal.db"),
            "DAI_LOCAL_DB_DIR": str(STATE / "patient-db"),
            "DAI_HOSPITAL_DB": str(ROOT / "backend/data/dai-hospital.db"),
            "DAI_PORTAL_API_ORIGIN": "http://127.0.0.1:8100",
            "DAI_PORTAL_WEB_ORIGIN": "http://127.0.0.1:3104",
            "API_ORIGIN": "http://127.0.0.1:8100",
            "NEXT_PUBLIC_DAI_BASE_PATH": "/hospital-admin",
            "DAI_NEXT_DIST_DIR": ".next-local",
            "WATCHPACK_POLLING": "1000",
            "DAI_ML_SERVICE_URL": "",
            "DAI_ML_ARTIFACT_DIR": str(ROOT / "hospital_portal/ml_service/artifacts"),
            "DAI_SOURCE_DB": str(ROOT / "backend/data/dai-hospital.db"),
            "PYTHON_BIN": str(PY),
            "npm_config_cache": str(STATE / "npm-cache"),
        }
    )
    return env


def dependencies():
    if not PY.exists():
        run([sys.executable, "-m", "venv", VENV])
    reqs = [
        ROOT / "hospital_portal/requirements.txt",
        ROOT / "synthetic_data/requirements.txt",
    ]
    if os.environ.get("ML_ENABLED") == "true":
        reqs.append(ROOT / "ml-service/requirements.txt")
    signature = hashlib.sha256(b"".join(p.read_bytes() for p in reqs)).hexdigest()
    marker = STATE / "python-dependencies"
    if not marker.exists() or marker.read_text() != signature:
        run([PY, "-m", "pip", "install", *[arg for req in reqs for arg in ("-r", req)]])
        marker.write_text(signature)
    for folder in ["backend", "hospital_portal/web"]:
        lock = ROOT / folder / "package-lock.json"
        sig = hashlib.sha256(lock.read_bytes()).hexdigest()
        mark = STATE / (folder.replace("/", "-") + "-dependencies")
        if (
            not (ROOT / folder / "node_modules").exists()
            or not mark.exists()
            or mark.read_text() != sig
        ):
            run(
                [NPM, "ci"],
                env=os.environ | {"npm_config_cache": str(STATE / "npm-cache")},
                cwd=ROOT / folder,
            )
            mark.write_text(sig)


def prepare(env):
    dependencies()
    if not (ROOT / "synthetic_data/output/dai.db").exists():
        run([PY, ROOT / "synthetic_data/generate.py"], env=env)
    if not (ROOT / "backend/data/dai-hospital.db").exists():
        run([PY, ROOT / "synthetic_data/build_hospital_admin.py"], env=env)
    run([PY, "-m", "hospital_portal.api.seed"], env=env)
    patient_env = env | {"DATABASE_URL": "", "DB_SSL": "false"}
    run(["node", ROOT / "scripts/seed-local.cjs"], env=patient_env)
    if not (ROOT / "hospital_portal/ml_service/artifacts/current.json").exists():
        run([PY, "-m", "hospital_portal.ml_service.train", "--persist"], env=env)
    else:
        run(
            [
                PY,
                "-c",
                "from hospital_portal.ml_service.store import manifest,forecast; from hospital_portal.ml_service.train import persist_predictions; m=manifest(); persist_predictions([forecast(n[:-5]) for n in m['files'] if n.startswith('HOSP-SYN-') and n.endswith('.json')])",
            ],
            env=env,
        )


def build_web(env):
    if env.get("DAI_DEV") == "true":
        return
    web = ROOT / "hospital_portal/web"
    files = sorted((web / "app").rglob("*")) + sorted((web / "scripts").rglob("*")) + [
        web / name
        for name in [
            "next.config.ts",
            "package.json",
            "package-lock.json",
            "tsconfig.json",
            "postcss.config.mjs",
        ]
        if (web / name).exists()
    ]
    # Assistant assets are shared with the static patient/doctor site. Include
    # them so pulling a new FAQ, model or animation refreshes the hospital build.
    for folder in ["frontend/assets/dr-daya", "frontend/vendor/three"]:
        files += sorted((ROOT / folder).rglob("*"))
    files += [ROOT / "frontend/js" / name for name in [
        "care-chatbot.js", "care-chatbot.css", "daya-avatar.mjs", "daya-knowledge.js"
    ]]
    fingerprint = hashlib.sha256(
        b"".join(
            str(p.relative_to(ROOT)).encode() + p.read_bytes()
            for p in files
            if p.is_file()
        )
    ).hexdigest()
    marker = STATE / "web-build"
    if (
        not (web / ".next-local/BUILD_ID").exists()
        or not marker.exists()
        or marker.read_text() != fingerprint
    ):
        # Next rewrites these generated type paths for each dist directory.
        # Preserve the checkout's files so a local start does not obstruct git pull.
        originals = {
            p: p.read_bytes()
            for p in [web / "next-env.d.ts", web / "tsconfig.json"]
            if p.exists()
        }
        try:
            run(
                [NPM, "run", "build", "--", "--webpack"],
                env=env | {"NODE_ENV": "production"},
                cwd=web,
            )
        finally:
            for path, contents in originals.items():
                path.write_bytes(contents)
        marker.write_text(fingerprint)


def ready(url, processes):
    for _ in range(120):
        if (STATE / "stop-request").exists():
            raise RuntimeError("DAI was stopped by npm run stop.")
        if any(p.poll() is not None for p in processes):
            raise RuntimeError(
                "A DAI service stopped. See its error above; no existing process was killed."
            )
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Service startup timed out: " + url)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "run"
    if action == "stop":
        stop_launcher()
        return
    env = environment(config())
    if action == "doctor":
        print(
            "Node:",
            shutil.which("node"),
            "\nPython:",
            sys.version.split()[0],
            "\nPatient database: embedded PostgreSQL (no separate server required)",
        )
        for filename in [
            "synthetic_data/output/dai.db",
            "backend/data/dai-hospital.db",
            ".local/patient-db",
            ".local/portal.db",
            "hospital_portal/ml_service/artifacts/current.json",
        ]:
            print(("OK      " if (ROOT / filename).exists() else "MISSING "), filename)
        return
    if action not in ("setup", "run"):
        raise RuntimeError("Use npm start, npm run setup, or npm run doctor.")
    processes = []
    (STATE / "stop-request").unlink(missing_ok=True)
    try:
        if action == "run":
            for port in [int(env["PORT"]), 3104, 8100]:
                with socket.socket() as check:
                    check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    try:
                        check.bind(("127.0.0.1", port))
                    except OSError:
                        raise RuntimeError(
                            f"Port {port} is already in use. Stop the old DAI terminal first (Ctrl+C). The launcher will not kill another process. Set DAI_PORT to change the public port."
                        )
        prepare(env)
        build_web(env)
        print(
            "\nSynthetic demo accounts (local only; never real patient data):\nPatient: mother@dai-synthetic.invalid\nDoctor: doctor@dai-synthetic.invalid\nHospital/Admin: hospital_admin@dai-synthetic.invalid\nPassword: Dai-Synthetic-2026!\nHospital OTP: displayed on the login screen, no SMS required.\n",
            flush=True,
        )
        if action == "setup":
            return
        commands = [
            (
                [
                    PY,
                    "-m",
                    "uvicorn",
                    "hospital_portal.api.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8100",
                ],
                ROOT,
                env,
            ),
            (
                (
                    [NPM, "run", "dev", "--", "--port", "3104"]
                    if env.get("DAI_DEV") == "true"
                    else [
                        "node",
                        ROOT / "hospital_portal/web/node_modules/next/dist/bin/next",
                        "start",
                        "--hostname",
                        "127.0.0.1",
                        "--port",
                        "3104",
                    ]
                ),
                ROOT / "hospital_portal/web",
                env
                | {
                    "NODE_ENV": "development"
                    if env.get("DAI_DEV") == "true"
                    else "production"
                },
            ),
            (
                ["node", "backend/server.js"],
                ROOT,
                env | {"DATABASE_URL": "", "DB_SSL": "false"},
            ),
        ]
        if env.get("ML_ENABLED") == "true":
            commands.insert(0, ([PY, ROOT / "ml-service/run.py", "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "8200"], ROOT, env))
        for args, cwd, child_env in commands:
            processes.append(
                subprocess.Popen(
                    [str(a) for a in args],
                    cwd=cwd,
                    env=child_env,
                    start_new_session=not WIN,
                )
            )
        required_processes = processes[1:] if env.get("ML_ENABLED") == "true" else processes
        for url in [
            "http://127.0.0.1:8100/api/health",
            "http://127.0.0.1:3104/hospital-admin",
            f"http://localhost:{env['PORT']}/api/health",
        ]:
            ready(url, required_processes)
        print(
            f"\nDAI ready → http://localhost:{env['PORT']}\nPatient • Doctor • Hospital/Admin — all from this address.\nCtrl+C stops the three apps; local database and edits are preserved.\n",
            flush=True,
        )
        while all(p.poll() is None for p in required_processes):
            if (STATE / "stop-request").exists():
                print("DAI stopped. Local data is preserved.")
                return
            time.sleep(1)
        raise RuntimeError(
            "A DAI service exited; stopping the remaining apps. See the error above."
        )
    finally:
        for p in reversed(processes):
            if p.poll() is None:
                if WIN:
                    subprocess.run(
                        ["taskkill", "/PID", str(p.pid), "/T", "/F"],
                        capture_output=True,
                    )
                else:
                    try:
                        os.killpg(p.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
        for p in processes:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] in ("doctor", "stop"):
            main()
        else:
            # Also tolerate an immediate start after an older, non-waiting stop.
            wait_timeout = 60 if (STATE / "stop-request").exists() else 0
            with workspace_lock(wait_timeout=wait_timeout):
                main()
    except KeyboardInterrupt:
        print("\nDAI stopped. Your local data is preserved.")
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print("\nDAI setup failed:", error, file=sys.stderr)
        sys.exit(1)
