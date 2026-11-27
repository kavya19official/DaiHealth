# Deploy this DAI synthetic demo

The deployment files are ready. Patient/doctor static files are hosted on Vercel. The Render Docker service runs Express, FastAPI, the hospital Next.js UI and private Python ML services. Vercel proxies `/api` and `/hospital-admin` to that service, preserving same-origin authentication.

## Recover an incomplete or stale Render deployment

The Free instructions in `RENDER-DEMO.md` intentionally disable ultrasound and patient ML ranking. They are a reduced demo, not the full local configuration. Free also cannot attach the persistent disk used by this deployment. For the full-feature topology use the Blueprint's Standard/2 GB RAM configuration (or its current equivalent), one instance, and a persistent disk; verify actual memory usage after deployment.

For the existing Render service:

1. Confirm the linked repository is `kavya19official/DaiHealth`, branch `main`, repository root, Docker runtime, `./Dockerfile`, and no custom Docker Command. In Settings select Auto-Deploy **On Commit**. The Blueprint now uses the same setting; existing manually created services require changing it in the dashboard.
2. To retain the demo database and uploaded reports, use a paid instance with a disk mounted at `/var/data`, and set `DAI_STATE_DIR=/var/data`. Moving from temporary storage does not migrate the old temporary data. Export needed reports before changing storage; recreate synthetic fixtures through the normal seed process.
3. Keep current signing, encryption and account secrets. If the local private import file differs from the deployed service, reconcile the existing values privately; do not blindly replace all secrets. Add missing feature settings: `DAI_SEED_NIVARA_DEMO=true`, `DAI_ULTRASOUND_ENABLED=true`, `ML_ENABLED=true`, `PATIENT_ML_RANKING_ENABLED=true`, `PENDING_CARE_ASSISTANT=true`, `PENDING_CARE_PLANNER=true`. Ultrasound also needs its existing image key and distinct gateway/service tokens. Add the existing record-connection encryption key for the demo record flow. Provider features need their configured provider credentials separately.
4. Select **Manual Deploy → Clear build cache & deploy**. Wait for the new deployment to be Live and check the startup log reaches `Hosted DAI is ready.` A green Express health response alone does not prove the hospital UI or ML service is ready.
5. Open `/api/health`. `deployment.commit` must match the intended GitHub commit. `deployment.configuredFeatures` reports flags, not model readiness, provider availability or successful end-to-end checks. If `deployment` is absent, the service is still serving an older build.
6. Sign out and sign in as `nivara@dai-synthetic.invalid`, then verify Aarav, the pregnancy profile, scan history and shared reports. Check the doctor and hospital portals too. Hosting installs the versioned fictional fixtures; it does not copy laptop-only uploads or database edits.
7. If using Vercel, check `DAI_BACKEND_ORIGIN` points to this exact Render service and rebuild Vercel after changing it. Compare Render directly with Vercel to distinguish backend and frontend updates.

## If startup reports `KeyError: DAI_ULTRASOUND_IMAGE_KEY`

Nivara's profile seed has completed; the ultrasound scan seed cannot encrypt its images because the enabled service has no image key. A code redeploy alone cannot supply an account environment setting. The launcher now checks all three required ultrasound settings before the database seed begins.

On the preparation machine, `.local/deployment/render-ultrasound.env` contains only the ultrasound enabled flag and the three existing ultrasound secrets copied from the private `render.env`. In the affected Render service, open **Environment → Edit → Add variable → Import from .env**, paste that private file's contents, and select **Save, rebuild, and deploy**. This does not change JWT or account passwords. Never commit or share the file. For manual entry, use the values without surrounding quote characters. Do not create replacement image keys for an existing encrypted image store.

## 1. Render

Create a **Web Service**, connect `kavya19official/DaiHealth`, select the branch containing these changes, and choose **Docker**.

- Repository root: leave blank (do not select `backend`).
- Dockerfile: `./Dockerfile`; use its existing build and start commands.
- Health check: `/api/health`.
- Use one instance and attach a persistent disk mounted at `/var/data`. The existing Blueprint specifies a 2 GB disk and Standard plan; choose the equivalent settings in the UI.
- Before the first deployment, import the private environment file at `.local/deployment/render.env` using Render's **Add from .env** facility. This file was generated on the development machine; it is deliberately absent from GitHub.
- The generated file contains fresh signing/encryption secrets and copies any configured Gemini/Sarvam and other explicitly allowlisted provider settings from `backend/.env`. It never copies local database URLs.
- Keep these secrets stable. Do not replace the environment file after a deployment has created accounts or encrypted reports. Changing `DAI_DEMO_PASSWORD` does not automatically reset existing seeded accounts.

Deploy, then check `https://YOUR-SERVICE.onrender.com/api/health`. Initial database seeding and model startup can take time.

The Docker image sets `DAI_HOSTED_DEMO=true`. The launcher uses embedded databases on the disk; do not add a PostgreSQL `DATABASE_URL` for this deployment.

## 2. Vercel

Import the same GitHub repository/branch.

- Framework: **Other**.
- Root directory: repository root.
- Keep build/install commands from `vercel.json`.
- Leave **Output Directory override disabled**. The build writes Vercel's native `.vercel/output` format; do not select `frontend` or `dist`.
- Add this environment variable for the deployment environments you intend to use:

```dotenv
DAI_BACKEND_ORIGIN=https://YOUR-SERVICE.onrender.com
```

Use the origin only, without `/api`, a path, credentials or a query string. Deploy. Changing this variable requires another Vercel build.

## 3. Finish the public URL

In Render, add:

```dotenv
DAI_PUBLIC_ORIGIN=https://YOUR-PROJECT.vercel.app
```

Save and redeploy/restart Render. This keeps swasthyaCard and other public links on the Vercel hostname.

Open `https://YOUR-PROJECT.vercel.app/demo-entry` first. The browser's demo access prompt uses username **demo** and the private file's **DAI_DEMO_ACCESS_KEY**. This sets the access cookie on the Vercel domain. Opening Render's URL first does not set a Vercel-domain cookie.

Then use the regular app login:

- Patient: `nivara@dai-synthetic.invalid`
- Doctor: `doctor@dai-synthetic.invalid`
- Hospital administration: `hospital_admin@dai-synthetic.invalid`
- Account password: the private file's **DAI_DEMO_PASSWORD**.

The hospital's demo OTP is displayed by the synthetic login flow; it is not a live SMS integration.

## Included demo data and persistence

`DAI_SEED_NIVARA_DEMO=true` installs the curated fictional Nivara/Aarav household once, creates a seven-day demo summary share with Hemangini, and installs three encrypted public demonstration scan records. A version marker prevents subsequent restarts from overwriting profile edits or re-enabling expired/revoked sharing. Existing released scan reviews are retained. Preloaded scan assessments remain clearly labelled demonstration data; they do not fabricate live model results.

Dates remain the authored fictional dates; gestational age advances with the calendar. This does not copy the laptop's entire `.local` database, private notes, uploaded files or previous accept/reject decisions. The normal synthetic cohort and fixture documents are installed separately by the launcher.

Patient reports, hospital upload files and hospital JSON state now use the persistent disk. Keep the service at one instance for this embedded database configuration.

## Optional live services

- Audio calls across networks: add `DAI_TURN_URL`, `DAI_TURN_USERNAME` and `DAI_TURN_PASSWORD` for your own working TURN relay. None was configured locally when this deployment file was prepared. Basic HTTPS alone cannot guarantee remote audio connectivity.
- Provider-backed speech/drafting: existing allowlisted keys/settings were copied if present. Check `SARVAM_API_KEY`, `GEMINI_API_KEY`, `DAI_CONSULTATION_AI_ENABLED=true` and an appropriate `DAI_CONSULTATION_AI_MODEL`. Provider availability/quota is separate from hosting.
- Google login: add the final Vercel origin to the Google client's authorised JavaScript origins.
- ABHA/DigiLocker remain labelled demo connection flows; government onboarding has not been completed.

## Verify before sharing

Sign in on each portal; upload and download a fictional report; book a visit and confirm it on the doctor side; send/accept a Doctor Connect request; test a call across networks if TURN is configured; generate and verify a QR; open ultrasound, hospital forecasts and Golden Hour. Restart Render and confirm the uploaded report remains.

## Local validation

```bash
DAI_BACKEND_ORIGIN=https://example.onrender.com npm run build:vercel
node --test backend/deployment.test.js backend/hostedNivara.test.js
hospital_portal/.venv/bin/python scripts/test_render_deploy.py
hospital_portal/.venv/bin/python scripts/test_hosted_scans.py
```

Docker was unavailable on the preparation machine. The complete Linux container build and live Vercel/Render routing must therefore be confirmed during the first cloud deployment.

References: [Vercel Build Output API](https://vercel.com/docs/build-output-api), [external rewrites](https://vercel.com/docs/routing/rewrites), [Render persistent disks](https://render.com/docs/disks).
