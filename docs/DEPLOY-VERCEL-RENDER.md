# Deploy this DAI synthetic demo

The deployment files are ready. Patient/doctor static files are hosted on Vercel. The Render Docker service runs Express, FastAPI, the hospital Next.js UI and private Python ML services. Vercel proxies `/api` and `/hospital-admin` to that service, preserving same-origin authentication.

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
