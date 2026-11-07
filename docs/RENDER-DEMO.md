# Deploy the synthetic demo on Render

This is a single-instance, access-gated Health-a-thon demo. One HTTPS origin serves patient, doctor and hospital so the existing local appointment bridge can still share its SQLite state with FastAPI. Express exposes the Render port. Next.js, FastAPI and the optional patient ranker bind only to loopback. The image builds the UI and regenerates synthetic source data and hospital forecast artifacts without importing local databases.

## Free web service

1. In Render, open the existing DAI **Web Service** or create one from the DAI GitHub repo. Select the `render-demo` branch, **Docker** runtime, and **Free** instance type. Use the repository-root `Dockerfile` and set the health check path to `/api/health`.
2. Clear any custom **Docker Command**. Set `DAI_STATE_DIR=/tmp/dai-state` in **Environment**. DAI creates this directory on startup.
3. Set `JWT_SECRET`, `DAI_DEMO_ACCESS_KEY` and `DAI_DEMO_PASSWORD` to distinct values of at least 32 characters each. Generate each with a separate `openssl rand -hex 24` run. Keep existing secrets if already set. Add `GEMINI_API_KEY` if you want Gemini voice.
4. Set `ML_ENABLED=false` and `PATIENT_ML_RANKING_ENABLED=false` to skip the optional patient ranker process. The image still includes the hospital forecast artifacts.
5. Select **Manual Deploy → Deploy latest commit**. Once the service is live, open its URL and use the login instructions below.

The Docker image runs native PostgreSQL over a private Unix socket in this mode to reduce memory usage. It needs no separate database service. Render Free discards local databases and uploads on a restart, redeploy, or idle shutdown. Each fresh start seeds synthetic records. Use this option for a disposable demo.

## Paid Blueprint with persistent data

1. In Render, open **New → Blueprint**, connect the DAI GitHub repo, and select the deployment branch containing `render.yaml`.
2. Review the paid service and 2 GB persistent disk in the Blueprint preview before deploying. Set `GEMINI_API_KEY` in Render if you want the Gemini voice. Leave it blank if it is unavailable.
3. After the service is healthy, copy its HTTPS URL. In the service's Environment settings, privately retrieve `DAI_DEMO_ACCESS_KEY` and `DAI_DEMO_PASSWORD`. Render generates both and the JWT secret on creation. Keep them stable for the lifetime of the demo disk.
## Sign in and verify

Open the service URL. The browser's access prompt uses username `demo` and `DAI_DEMO_ACCESS_KEY`. Inside DAI, use `DAI_DEMO_PASSWORD` with `mother@dai-synthetic.invalid`, `doctor@dai-synthetic.invalid` or `hospital_admin@dai-synthetic.invalid`. The hospital OTP is displayed in demo mode.

Test all three roles, then make one synthetic appointment request and confirm it appears in the hospital queue. Check the forecast view, Green Hospital, and any configured planner or Gemini speech.

The mounted disk contains both demo databases and uploaded PDF files. Never attach your existing laptop data or enter real patient data. Keep a single instance so both processes continue to share the same state. This is not a production healthcare deployment. Redis, the background worker and a separate hospital forecast API are not needed for this demo topology. The built-in hospital forecast artifact reader serves the forecast page.

If changing the source cohort, use a new demo disk rather than overwriting the existing records. A new demo account password requires reseeding or an intentional credential rotation. Rotating only the outer access key invalidates access cookies without altering demo accounts. Retain `JWT_SECRET` or configure a stable `TIMELINE_AUDIT_KEY` to preserve signed timeline history.
