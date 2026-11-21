# DaiHealth feature audit and setup

Audited `main` at `9f1e16e`. The feature commits are `9120631` (CareScan),
`7e92074` (consent and access receipts) and `9f1e16e` (ASHA Copilot).

| Feature | Findings and changes |
| --- | --- |
| Photo-to-Timeline | A selectable header could cause PDF.js to skip OCR on a scanned page. Mixed pages now preserve the text layer and process the scanned portions. Files whose browser omits their MIME type can reach server-side signature validation. Entries still require individual review and confirmation before they are saved. |
| ASHA Copilot | Restoring an ASHA session could land on the wrong tab. Network interruptions could discard the workspace and rejected items could be retried in a loop. The workspace now restores into ASHA Copilot, keeps the open field list through transient disconnects, and separates retryable items from validation failures. The outbox uses browser-local encrypted IndexedDB storage and migrates the previous plaintext queue when it is opened. Worker assignment, camp payloads and same-identifier retries are validated server-side. |
| Consent and access receipts | The dashboard used the wrong receipt URL and fetched the chain twice. Receipts could attribute consent to the recipient and report transaction start as the enforcement timestamp. Family, document, timeline and remote sharing are now captured against the underlying change. The UI reports verification failures and supports pagination, signed downloads and public-key downloads. Captured events are checked before sealing, receipt signatures are verified before download, and previously issued receipts retain their original public key across signing-key changes. |

## Local demo

Use Node 24, npm and Python 3.12. From the repository root:

```bash
npm start
```

The launcher installs dependencies, generates the synthetic source dataset,
applies migrations, creates local secrets and starts Express, FastAPI and Next.js.
Use the single origin `http://localhost:3001`. After pulling an update, stop and
restart the launcher with `npm run stop` and `npm start` so it applies the migration.

- **CareScan** opens with **Scan a document** in the mother dashboard's
  **Reports & records** or **Care timeline**. Use a printed-English PNG, JPEG,
  WebP or PDF up to 5 MB. OCR processes up to the first five pages. Tesseract,
  its English model, and PDF.js are installed from the backend lockfile. No OCR
  API key, cloud OCR service or system Tesseract installation is required.
- **ASHA Copilot** is available through
  `http://localhost:3001/auth.html?role=hospital`. The local demo ASHA account
  is `asha@dai-synthetic.invalid`. The default local demo password is
  `Dai-Synthetic-2026!`; hosted demos use their configured demo password.
  Use the simulated OTP shown on the sign-in screen. Typed-note extraction and
  route estimates use local rules and require no AI or maps API key. Dictation
  requires a browser with on-device Web Speech recognition, microphone
  permission, and an English (India) language pack. Text entry is available
  even when dictation is unavailable. The outbox needs a secure origin
  (HTTPS or localhost), IndexedDB and Web Crypto. Keep the page open to use
  an already loaded field list offline. A fresh offline load cannot sign in
  or download an assigned roster.
- **Receipts** are in the mother dashboard's **Family & consent** panel.
  The local launcher creates the audit HMAC key and Ed25519 signing key in
  `.local/` on first use. Keep that directory when restarting or upgrading.

`GEMINI_API_KEY` is unrelated to these three workflows. It remains optional
for the separate Dhruv voice integration.

## Standalone deployment

1. Apply the existing Express migrations in repository order. For a database
   already migrated to the audited revision, apply this upgrade:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/consent_audit_hardening.sql
   ```

   For a pre-feature database, apply `care_scan.sql`, then
   `consent_audit.sql`, then `consent_audit_hardening.sql` after the existing
   prerequisite migrations. Run migrations as the owner and give the runtime
   role only the database operations it needs. Keep production DB credentials
   and TLS settings in the deployment's secret store.

2. Configure Express with the existing `DATABASE_URL`, `JWT_SECRET` and
   `TIMELINE_AUDIT_KEY`. Set `PATIENT_DOCS_DIR` to a private persistent volume
   accessible to the Express process. For a **new** consent audit deployment,
   generate its keys on a trusted machine:

   ```bash
   umask 077
   openssl rand -hex 32 > consent-audit-secret.txt
   openssl genpkey -algorithm ED25519 -out receipt-private.pem
   openssl base64 -A -in receipt-private.pem -out receipt-private.b64
   openssl pkey -in receipt-private.pem -pubout -out receipt-public.pem
   ```

   Put the contents of `consent-audit-secret.txt` in
   `CONSENT_AUDIT_KEY`, and `receipt-private.b64` in
   `CONSENT_RECEIPT_PRIVATE_KEY`. Never send either secret to the browser or
   commit these files. If the current ledger uses the timeline-key fallback,
   keep that same effective HMAC key in `CONSENT_AUDIT_KEY`. Changing the
   HMAC key invalidates verification of existing seals. Keep prior receipt
   public keys and pin an authenticated key before relying on an offline
   receipt. For pre-upgrade receipts, download them once with the old key
   active before rotating so DaiHealth can archive its public half.

3. FastAPI needs its own supported database and production session
   configuration. Run `hospital_portal/api/migrations/20261121_asha_copilot.sql`
   on an existing PostgreSQL portal database after the portal's previous
   migrations. The FastAPI initializer creates missing tables on a fresh
   demo SQLite database. Expose the portal with the existing
   `/hospital-admin` prefix, route `/hospital-admin/api/*` to FastAPI, and set
   `NEXT_PUBLIC_DAI_BASE_PATH=/hospital-admin` at the Next.js build and
   `API_ORIGIN` to the FastAPI origin. Use existing facility user management
   to provision verified ASHA staff and assign beneficiaries. The synthetic
   seed runs only with `DAI_DEMO=true`. Set `DAI_SOURCE_DB` to the generated
   synthetic SQLite file when operating the synthetic demo outside the launcher.
   The portal's existing standalone production login requires its own OTP
   provider. These changes do not add an external OTP delivery service.

4. Exact revocation commit time requires PostgreSQL commit timestamp tracking:

   ```sql
   ALTER SYSTEM SET track_commit_timestamp = on;
   ```

   Restart PostgreSQL using your deployment's normal service controls and confirm
   `SHOW track_commit_timestamp;` returns `on`. On a managed service use its
   instance setting if `ALTER SYSTEM` is unavailable. Commit history begins
   once the setting is enabled and can age out. If the exact value is unavailable,
   receipts still sign the database-recorded change time and a time by which
   it had committed. They leave `effective_at` blank in JSON in that case.

## Verify a receipt offline

Download a signed JSON receipt and get the matching Ed25519 public key from a
trusted deployment. From the repository root:

```bash
node scripts/verify-consent-receipt.cjs dai-receipt-123.json receipt-public.pem
```

The signature covers the receipt's event, timestamps and chain checkpoint.
For a rotated signing key, the authenticated key endpoint accepts
`?key_id=<receipt signer.key_id>`. Preserve signed receipts outside the
application when you need evidence against coordinated database rollback.
The audit traces records within the Express patient system. Facility ASHA
activity uses the separate portal audit and is outside that patient receipt.
A revocation blocks subsequent authorization under that grant. It cannot
recall copies already delivered to a previously authorized client.
