# Sukoon — Mind and rest

Sukoon is a prototype recovery space offered to every mother beside Daily tracking. It uses the same invitation and tone for everyone. Private entries never become a diagnosis, patient risk label, streak or score display. It is **not clinically signed off**. Keep the visible prototype label until clinical, safety, privacy and content review are complete.

## What is built

| Experience | Actual behaviour |
| --- | --- |
| Daily carrying moment | Five self-selected weather states, an optional 240-character note, and a prepared kind reply. Same-day edits replace the day's entry. Nothing is inferred from voice or patterns. |
| Weather inside | Seven recorded days with earlier-week navigation. Missing days remain empty. A soft support invitation appears after at least three self-recorded heavy days in the displayed current week; it does not classify a condition. |
| Breathing pause | Soft light and optional Vibration API pulses. No breath holds, physiological measurement, or syncing to a baby's feeding pace. Safari and other unsupported browsers use the light/text fallback. Reduced-motion users get a static visual. |
| Five-minute grounding | Five fixed English/Hindi segments with quiet pauses, visible text, stop and mute. Dhruv uses the existing allowlisted Charon TTS/cache service. The scripts are prototype content awaiting professional approval; no private notes, answers or free-form prompts go to Gemini. |
| Tap out / rest fort | A reviewed, explicitly confirmed in-app request to one accepted Family Circle support person, then a separate local rest timer. Requested, accepted and helper-marked done remain distinct. No phone alarm, emergency dispatch, push delivery, OS notification suppression or call blocking is claimed. |
| Open when letters | Written notes and up-to-one-minute recordings, or an imported audio file up to 700 KB. The author/recorder confirms permission. Letters stay in the encrypted vault and are never submitted to a model. Closing/quick-hide stops playback and recording. Up to 20 letters, subject to the vault size cap. |
| Night companion | Dimmable illustrated sky, quiet audio and private letters. Decorative stars are explicitly not people or locations. Live counts are disabled by default; see the flag below. |
| Invisible load | A donut and accessible count labels from actually logged tasks. Each person logs their own contribution. No percentages of overall labour, time, fairness, blame or comparative ranking are claimed. Family revocation removes access and excludes that person's contribution from the shared view. |
| Family support | Existing accepted, unexpired `support_tips` grants allow reviewed practical requests and self-reported task logs. The caregiver page can accept/finish a request and log a task. Family never receives journal notes, letters or questionnaire results. |
| Support cards | Same three choices: care team, someone trusted, or not now. Practical partner/elder guidance is prepared content. A named contact is not a record-access grant. |
| Recovery questionnaire | Existing EPDS items/scoring moved into `shared/sukoon.js` and re-exported by `backend/daicareEpds.js`, so there is one scoring implementation. Exact ten English questions, response order and seven-day recall period are preserved in one-question screens. Standard instrument purpose is explained honestly in the introduction. |
| Clinical sharing | A private completed check-in stays local. A separate confirmation first saves chosen answers in the existing DAI clinical record and then asks the existing on-call service for review. The clinician receives name/result/priority; family receives none of it. The existing record's storage/retention rules are explained before writing; this record is not claimed to have client-side end-to-end encryption. Sharing can be withdrawn without pretending an existing clinical record was erased. |
| Clinician follow-up | Consented on-call referrals reuse the existing verified coverage, acknowledgement and resolution flow, with a recorded follow-up due timestamp one day after the request. The task date is not a promise that staff will respond within a day. Existing item-ten prioritisation and human review remain authoritative. |
| Care invitations | Prototype invitations around 14, 42 and 90 days from a recorded delivery, plus a check-in available on request. Missing delivery dates do not create a pregnancy/postpartum age. Old missed milestones are not turned into a backlog. |
| Immediate help | A direct screen for a nonzero item-ten answer or explicit concerning disclosures. No diagnostic interpretation is made and nothing is auto-shared. The screen must appear even if encrypted saving fails. Trusted person/hospital contacts, existing SOS, India 112 and verified Tele-MANAS 14416 are available. It says to seek urgent in-person help and not wait for an app reply. |
| Visit summary | Preview and download recorded weather dates plus dates of check-ins chosen for review. Private notes, letters and numeric clinical scores are excluded. The user decides whether to give the file to someone. |
| Privacy and controls | Lock/quick-hide, encrypted export/backup, explicit restore and deletion. In-app reminders are opt-in and use neutral text. Every dialog has quick-hide, emergency access and a large close control. |

## Private storage and access

`frontend/js/sukoon-vault.js` uses a separate IndexedDB database, `dai-sukoon-private-v1`. AES-256-GCM protects the payload. A non-exportable key is derived from a minimum-12-character passphrase using PBKDF2-SHA-256, a random 24-byte salt and 400,000 iterations. Each write uses a fresh 12-byte IV. Associated data binds the payload to a hashed DAI origin/account identity; guest previews have a separate identity. Passphrases and keys never enter localStorage, a request body, a cookie or the server.

Only ciphertext/envelope metadata may be saved to the optional server backup. The server cannot decrypt the journal. Backups are bound to the same DAI origin/account and require the original passphrase. Forgotten passphrases cannot be recovered. Cryptographic integrity errors and cross-account restores are rejected. Local revision checks prevent a stale tab overwriting newer data; server backup writes compare an expected UUID revision and return a conflict rather than silently overwriting.

The private space locks on visibility loss, navigation away, quick hide, or five minutes idle. Decrypted DOM, audio, recording streams and in-memory keys are cleared/stopped. Quick hide does **not** erase browser history, OS previews or copies the user deliberately downloaded. The prototype does not claim protection against a compromised device, browser extension or active XSS. The vault caps the plaintext UTF-8 payload at 4 MB before encryption.

`/api/patient/sukoon/*` requires the existing authenticated mother role. Family requests/duties recheck accepted, unexpired, unrevoked `support_tips` grants and active accounts, including on acknowledgement. API responses use private/no-store headers. Consent/request/backup events use the existing access audit without notes or question answers. Complete export includes the encrypted backup and the mother's practical records; account closure deletes the encrypted server backup/presence/preferences and revokes existing sharing. Local encrypted copies have their own visible delete control.

Sukoon does not silently send an ASHA/nurse message, interpret microphone tone, publish mother's recordings, or present an assigned clinician as having already reviewed a result. Notes are not continuously monitored. Clinical sharing and crisis resources cannot substitute for a staffed service.

## Honest prototype limits / release gates

- **Clinical approval is pending.** A clinician/mental-health professional must review the wording, care timing, scoring integration, safety screen, triage procedure and grounding scripts before public clinical use. EPDS screening is not a diagnosis; clinician review makes the clinical decision.
- **Hindi navigation and prepared comfort scripts are implemented.** The questionnaire currently uses the existing English instrument. A validated Hindi/regional-language version and its reproduction permissions must be verified before adding it; ad-hoc translations are not substituted for validated items.
- **Mothers' voices is a concept preview.** The supplied stories explicitly introduce themselves as fictional illustrations, not real anonymous testimony. Publishing actual mothers' stories needs permission, moderation and a safeguarding workflow; none is fabricated.
- **ASHA/nurse delivery is not connected.** The care-team action uses the existing on-call clinician queue. A neutral download may be chosen for a visit. Routing to a community worker needs a reviewed consent/access workflow and staffed operations.
- **Rest requests are in-app.** A caregiver must be signed in and check their family page/refresh it. SMS, WhatsApp, Web Push, alarm calls and OS do-not-disturb need separate providers/permissions and are not advertised as working here.
- **Anonymous awake counts are off by default.** `SUKOON_AWAKE_COUNTS=true` enables explicitly opted-in five-minute sessions. Only a national total is returned, rounded down to groups of ten; totals below ten are suppressed, never replaced with zero or invented values. No coordinates, region records, identities or per-person endpoints are returned. Decorative stars remain unrelated to counts. This needs operational/privacy/load evaluation before a public demo claim.
- Haptic behaviour, microphone permissions, audio interruption and phone previews need real-device testing, including Safari/iOS and a mid-range Android phone. Browsers cannot silence other apps or guarantee timely notifications.

## Sources and checked contact

- [COPE EPDS guidance](https://www.cope.org.au/health-professionals/screening-and-assessment-tools/using-the-epds-as-a-screening-tool) and the existing project attribution: Cox JL, Holden JM, Sagovsky R (1987), *British Journal of Psychiatry*, 150, 782–786. Preserve the validated instrument instead of making its items sound gentler.
- [NHS postpartum psychosis information](https://www.nhs.uk/mental-health/conditions/post-partum-psychosis/) informs the direct-help boundary for severe confusion and seeing/hearing things others do not; the app does not diagnose that condition.
- The session's verified hotline lookup confirmed [14416](tel:+9114416?oai_link_source=model_response_hotline) and [official Tele-MANAS information](https://telemanas.mohfw.gov.in/home?oai_link_source=model_response_hotline). The alternative phone number in the concept brief was not added because it was not returned by that verification. Recheck before launch.

## Setup and tests

`npm start` applies `backend/db/sukoon.sql` through the existing launcher. Both `scripts/seed-local.cjs` and `scripts/check-local.cjs` include it. Keep `SUKOON_AWAKE_COUNTS=false` in the primary demo unless that capability is reviewed and intentionally enabled. Existing Gemini credentials power only the prepared speech service; no new model or credentials are needed for private check-ins.

```sh
npm run test:sukoon
npm test --prefix backend
NODE_PATH=/tmp/dai-browser/node_modules node scripts/test-sukoon-browser.cjs
DAI_TEST_WEBKIT=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/dai-webkit NODE_PATH=/tmp/dai-browser/node_modules node scripts/test-sukoon-browser.cjs
```

Browser tests use isolated synthetic accounts, real WebCrypto/IndexedDB and generated WAV files with a mock prepared-speech response. They cover missing weather days, encrypted audio letters, no private text in API/AI requests, opt-in clinical writes, rest-request confirmation, encrypted backup confirmation, cross-account restore rejection, tampering, stale-tab conflicts, incorrect passphrases, quick-hide DOM/audio cleanup, Hindi/dark layouts, and immediate help even when the storage transaction aborts. Native microphone/haptic/device service behaviour is not claimed as evaluated by these fixtures. Screenshots are stored under `/private/tmp/dai-sukoon`.
