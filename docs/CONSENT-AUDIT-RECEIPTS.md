# Tamper-evident consent & access receipts

Every patient consent change, revocation and medical-record access is recorded
in an append-only, hash-chained audit log. Mothers can verify the chain from
their dashboard and download digitally signed receipts for any event.

## What is recorded

Database triggers (`backend/db/consent_audit.sql`) copy each write into
`consent_audit_events`:

| Source table | Events captured |
|---|---|
| `patient_access_controls` | `consent_granted` / `consent_revoked` for doctors and facilities (including mass revocations on account closure) |
| `patient_access_events` | `access_revoked`, `access_granted`, `dashboard_consent`, `remote_visit_consent`, sharing history, self views, exports |
| `patient_record_access_log` | `record_access` / `access_denied` — who viewed which resource, and blocked attempts |
| `patient_document_events` | document upload/download/share/revoke |
| `family_access_events` | family grant invite/accept/read/revoke |
| `continuity_access` | scoped record-access grants and revokes |
| `patient_stay_access_log` | hospital-stay record views |

## Integrity model

- **Append-only**: `UPDATE`/`DELETE` on `consent_audit_events`,
  `consent_audit_seals`, `consent_receipts` and `consent_audit_heads` is
  rejected by triggers.
- **Hash chain**: each event is sealed with
  `HMAC-SHA256(previous_hash ‖ canonical(event))` per mother, in id order.
  `consent_audit_heads` stores the chain head; sealing takes the head row
  `FOR UPDATE`, which serialises it against the capture triggers so a
  verifier never seals across an uncommitted lower-id event.
- **Verification is real**: `GET /api/patient/audit/verify` recomputes every
  seal from the event rows and fails closed (HTTP 409) on any mismatch —
  including edits made by disabling the immutability triggers.
- **Timestamps** come from the database clock (`NOW()` / source-row
  `created_at`), never the client.

## Signed receipts

`consent_receipts` stores one Ed25519-signed receipt per audit event
(`UNIQUE(audit_event_id)`, issued on demand or at consent-change time).
The signed payload covers the event (who, when, what, details), its chain
position (`sequence`, `previous_hash`, `event_hash`, `head_hash`) and the
signer key id. Revocation receipts additionally carry `effect.occurred_at`
(exact revocation timestamp) and `effect.effective_at` (when restrictions
began — immediate, since authorisation re-checks consent on every request).

Endpoints (mother role only):

- `GET /api/patient/audit/verify` — validity, sequence, head hash
- `GET /api/patient/audit/events?limit&before` — events with chain positions
- `GET /api/patient/audit/public-key` — Ed25519 public key for offline checks
- `GET /api/patient/audit/events/:id/receipt` — downloadable signed receipt
- `GET /api/patient/receipts` — issued receipts

`PUT /api/patient/access/:type/:ref` now commits the consent row, the choice
event and the receipt in one transaction, and returns `receipt_id`.

## Keys

- Chain HMAC key: `CONSENT_AUDIT_KEY` (≥32 chars), falling back to
  `TIMELINE_AUDIT_KEY`, then `.local/consent-audit.key` when `DAI_LOCAL=true`.
- Receipt signing: `CONSENT_RECEIPT_PRIVATE_KEY` (Ed25519 PKCS8 PEM, raw or
  base64), else `.local/consent-receipt-private.pem` (mode 0600) in local dev.
  Only the public key is served.

## Coverage note

The log covers access made through DAI. It does not cover access inside a
hospital's own systems, which remain outside DAI's visibility.
