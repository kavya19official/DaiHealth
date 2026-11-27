"""Run the synthetic, single-instance DAI demo behind Render HTTPS."""
from contextlib import contextmanager
import os
import pwd
import re
import shlex
import subprocess
from tempfile import TemporaryDirectory
from pathlib import Path
from urllib.parse import urlsplit

from local import ROOT, environment


TEMPORARY_STATE = Path("/tmp/dai-state")


def state_directory():
    return Path(os.environ.get("DAI_STATE_DIR", "/var/data")).resolve()


def mount_state():
    mount = state_directory()
    # Render Free can explicitly opt in to disposable synthetic demo data.
    if mount == TEMPORARY_STATE.resolve():
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


def validate_ultrasound_environment(env):
    """Fail before database seeding; never invent or rotate image-encryption keys."""
    if env.get("DAI_ULTRASOUND_ENABLED") != "true":
        return
    invalid = []
    if not re.fullmatch(r"[a-fA-F0-9]{64}", env.get("DAI_ULTRASOUND_IMAGE_KEY", "")):
        invalid.append("DAI_ULTRASOUND_IMAGE_KEY (64 hexadecimal characters)")
    for name in ("DAI_ULTRASOUND_GATEWAY_TOKEN", "DAI_ULTRASOUND_SERVICE_TOKEN"):
        if len(env.get(name, "")) < 32:
            invalid.append(name + " (at least 32 characters)")
    if invalid:
        raise RuntimeError(
            "Ultrasound is enabled but these Render environment settings are missing or invalid: "
            + ", ".join(invalid)
            + ". In Render > Environment, import the existing private render-ultrasound.env "
            "settings and save/deploy. Reuse existing keys; do not rotate keys for encrypted scans."
        )


def hosted_environment():
    required = ("JWT_SECRET", "DAI_DEMO_PASSWORD", "DAI_DEMO_ACCESS_KEY")
    for name in required:
        if len(os.environ.get(name, "")) < 32:
            raise RuntimeError(f"Set {name} to a unique secret of at least 32 characters.")
    if len({os.environ[name] for name in required}) != len(required):
        raise RuntimeError("Use separate secrets for demo access, demo accounts and JWTs.")
    validate_ultrasound_environment(os.environ)
    origin = (os.environ.get("DAI_PUBLIC_ORIGIN") or os.environ.get("RENDER_EXTERNAL_URL", "")).rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError("Set DAI_PUBLIC_ORIGIN or RENDER_EXTERNAL_URL to the public HTTPS origin.")
    web_port = int(os.environ.get("DAI_HOSTED_WEB_PORT", "3104"))
    api_port = int(os.environ.get("DAI_HOSTED_API_PORT", "8100"))
    api_origin = f"http://127.0.0.1:{api_port}"
    env = environment({"jwt_secret": os.environ["JWT_SECRET"], "demo_password": os.environ["DAI_DEMO_PASSWORD"]})
    env.update(
        NODE_ENV="production",
        DAI_DEV="false",
        DAI_LOW_MEMORY="true" if state_directory() == TEMPORARY_STATE.resolve() else "false",
        DAI_VIDEO_DEMO="true",
        PORT=os.environ.get("PORT", "10000"),
        DAI_WEB_ORIGIN=origin,
        DAI_PUBLIC_ORIGIN=origin,
        DAI_PORTAL_WEB_ORIGIN=f"http://127.0.0.1:{web_port}",
        DAI_PORTAL_API_ORIGIN=api_origin,
        API_ORIGIN=api_origin,
        PATIENT_DOCS_DIR=str(ROOT / ".local/documents"),
        HOSPITAL_STATE_FILE=str(ROOT / ".local/hospital-demo-state.json"),
        HOSPITAL_UPLOAD_DIR=str(ROOT / ".local/hospital-uploads"),
    )
    return env


@contextmanager
def patient_database(env):
    """Run a small Unix-socket-only PostgreSQL instance for the free hosted demo."""
    if env.get("DAI_LOW_MEMORY") != "true":
        yield env
        return

    state = state_directory()
    cluster = state / "patient-postgres"
    # PostgreSQL refuses to run as root. The image's postgres user owns the free demo cluster.
    account = pwd.getpwnam("postgres") if os.geteuid() == 0 else None
    identity = {"user": account.pw_uid, "group": account.pw_gid, "extra_groups": []} if account else {}

    def postgres(command, *args):
        subprocess.run([command, *args], check=True, **identity)

    with TemporaryDirectory(prefix="dai-pg-", dir="/tmp") as socket:
        if account:
            os.chown(state, account.pw_uid, account.pw_gid)
            os.chown(socket, account.pw_uid, account.pw_gid)
        if not cluster.exists():
            # Publish the cluster only after initdb succeeds, so failures can be retried.
            with TemporaryDirectory(prefix="postgres-init-", dir=state) as workspace:
                if account:
                    os.chown(workspace, account.pw_uid, account.pw_gid)
                stage = Path(workspace) / "data"
                postgres("initdb", "-D", stage, "--username=postgres", "--auth-local=trust", "--auth-host=reject")
                stage.rename(cluster)
        options = shlex.join([
            "-k", socket,
            "-c", "listen_addresses=",
            "-c", "shared_buffers=16MB",
            "-c", "work_mem=1MB",
            "-c", "maintenance_work_mem=16MB",
            "-c", "max_connections=10",
        ])
        postgres("pg_ctl", "-D", cluster, "-l", cluster / "server.log", "-o", options, "-w", "start")
        try:
            yield env | {"DAI_PATIENT_PG_SOCKET": socket}
        finally:
            postgres("pg_ctl", "-D", cluster, "-m", "fast", "-w", "stop")
