# Deploy the synthetic demo on Render

This is a single-instance, access-gated Health-a-thon demo. One HTTPS origin serves patient, doctor and hospital so the existing local appointment bridge can still share its SQLite state with FastAPI. Express exposes the Render port. Next.js, FastAPI and the optional patient ranker bind only to loopback. The image builds the UI and regenerates synthetic source data and hospital forecast artifacts without importing local databases.

1. In Render, open **New → Blueprint**, connect the DAI GitHub repo, and select the deployment branch containing `render.yaml`.
2. Review the paid service and 2 GB persistent disk in the Blueprint preview before deploying. Set `GEMINI_API_KEY` in Render if you want the Gemini voice. Leave it blank if it is unavailable.
3. After the service is healthy, copy its HTTPS URL. In the service's Environment settings, privately retrieve `DAI_DEMO_ACCESS_KEY` and `DAI_DEMO_PASSWORD`. Render generates both and the JWT secret on creation. Keep them stable for the lifetime of the demo disk.
4. Open the URL. The browser's outer access prompt uses username `demo` and the access key. Inside DAI, use the account password for `mother@dai-synthetic.invalid`, `doctor@dai-synthetic.invalid` or `hospital_admin@dai-synthetic.invalid`. The hospital OTP is displayed in demo mode.
5. Test all three roles, then make one synthetic appointment request and confirm it appears in the hospital queue. Check the forecast view, Green Hospital, planner and any configured Gemini speech.

The mounted disk contains both demo databases and uploaded PDF files. Never attach your existing laptop data or enter real patient data. Keep a single instance so both processes continue to share the same state. This is not a production healthcare deployment. Redis, the background worker and a separate hospital forecast API are not needed for this demo topology. The built-in hospital forecast artifact reader serves the forecast page.

If changing the source cohort, use a new demo disk rather than overwriting the existing records. A new demo account password requires reseeding or an intentional credential rotation. Rotating only the outer access key invalidates access cookies without altering demo accounts. Retain `JWT_SECRET` or configure a stable `TIMELINE_AUDIT_KEY` to preserve signed timeline history.
