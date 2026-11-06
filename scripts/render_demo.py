"""Run the synthetic, single-instance DAI demo behind Render HTTPS."""
import os
from pathlib import Path
from urllib.parse import urlsplit

from local import ROOT, environment


def mount_state():
    mount = Path(os.environ.get("DAI_STATE_DIR", "/var/data")).resolve()
    if not mount.is_dir():
        raise RuntimeError("Attach a persistent disk at DAI_STATE_DIR before starting.")
    link = ROOT / ".local"
    if link.is_symlink() and link.resolve() == mount:
        return
    if link.exists() or link.is_symlink():
        raise RuntimeError("Hosted demo requires a clean checkout without local data.")
    link.symlink_to(mount, target_is_directory=True)


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
