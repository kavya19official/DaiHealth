"""Run the synthetic, single-instance DAI demo behind Render HTTPS."""
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import urlsplit

from local import ROOT, environment

TEMPORARY_STATE = Path("/tmp/dai-state").resolve()


def mount_state():
    mount = Path(os.environ.get("DAI_STATE_DIR", "/var/data")).resolve()
    # Render Free can explicitly opt in to disposable synthetic demo data.
    if mount == TEMPORARY_STATE:
        mount.mkdir(mode=0o700, exist_ok=True)
    elif not mount.is_dir():
        raise RuntimeError(
            "Attach a persistent disk at DAI_STATE_DIR, or set "
            "DAI_STATE_DIR=/tmp/dai-state for a disposable synthetic demo."
        )
    link = ROOT / ".local"
    if link.is_symlink() and link.resolve() == mount:
        return
    if link.exists() or link.is_symlink():
        raise RuntimeError("Hosted demo requires a clean checkout without local data.")
    link.symlink_to(mount, target_is_directory=True)


def start_demo_postgres(env, processes):
    """Keep the hosted demo database off TCP and bound to its private local socket."""
    state = (ROOT / ".local").resolve()
    postgres_bin = env.get("DAI_POSTGRES_BIN")
    if state != TEMPORARY_STATE or not postgres_bin:
        return
    bin_dir = Path(postgres_bin)
    pg_dir = state / "postgres"
    pg_socket = state / "postgres-socket"
    prefix = []
    for directory in (pg_dir, pg_socket):
        directory.mkdir(mode=0o700, exist_ok=True)
    if os.geteuid() == 0:
        # The container runs as root, but PostgreSQL must run as its own user.
        shutil.chown(state, group="postgres")
        state.chmod(0o710)
        for directory in (pg_dir, pg_socket):
            shutil.chown(directory, user="postgres", group="postgres")
        prefix = ["runuser", "-u", "postgres", "--"]
    if not (pg_dir / "PG_VERSION").is_file():
        subprocess.run(
            [*prefix, str(bin_dir / "initdb"), "-D", str(pg_dir), "-U", "postgres",
             "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"],
            check=True,
        )
    process = subprocess.Popen(
        [*prefix, str(bin_dir / "postgres"), "-D", str(pg_dir), "-k", str(pg_socket), "-p", "5432",
         "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700",
         "-c", "shared_buffers=8MB", "-c", "work_mem=1MB", "-c", "max_connections=8",
         "-c", "autovacuum_max_workers=1", "-c", "jit=off"],
        start_new_session=True,
    )
    processes.append(process)
    for _ in range(60):
        if process.poll() is not None:
            break
        result = subprocess.run(
            [str(bin_dir / "pg_isready"), "-h", str(pg_socket), "-p", "5432", "-U", "postgres", "-q"],
            check=False,
        )
        if result.returncode == 0:
            env["DAI_HOSTED_POSTGRES_SOCKET"] = str(pg_socket)
            env.setdefault("NODE_OPTIONS", "--max-old-space-size=160 --max-semi-space-size=2")
            return
        time.sleep(0.5)
    raise RuntimeError("The hosted demo PostgreSQL instance did not become ready.")


def hosted_environment():
    required = ("JWT_SECRET", "DAI_DEMO_PASSWORD", "DAI_DEMO_ACCESS_KEY")
    for name in required:
        if len(os.environ.get(name, "")) < 32:
            raise RuntimeError(f"Set {name} to a unique secret of at least 32 characters.")
    if len({os.environ[name] for name in required}) != len(required):
        raise RuntimeError("Use separate secrets for demo access, demo accounts and JWTs.")
    origin = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError("Set RENDER_EXTERNAL_URL to the public HTTPS origin.")
    web_port = int(os.environ.get("DAI_HOSTED_WEB_PORT", "3104"))
    api_port = int(os.environ.get("DAI_HOSTED_API_PORT", "8100"))
    api_origin = f"http://127.0.0.1:{api_port}"
    env = environment({"jwt_secret": os.environ["JWT_SECRET"], "demo_password": os.environ["DAI_DEMO_PASSWORD"]})
    env.pop("DAI_HOSTED_POSTGRES_SOCKET", None)
    env.update(
        NODE_ENV="production",
        DAI_DEV="false",
        DAI_VIDEO_DEMO="true",
        PORT=os.environ.get("PORT", "10000"),
        DAI_WEB_ORIGIN=origin,
        DAI_PUBLIC_ORIGIN=origin,
        DAI_PORTAL_WEB_ORIGIN=f"http://127.0.0.1:{web_port}",
        DAI_PORTAL_API_ORIGIN=api_origin,
        API_ORIGIN=api_origin,
        PATIENT_DOCS_DIR=str(ROOT / ".local/documents"),
    )
    return env
