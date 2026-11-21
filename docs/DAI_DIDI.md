# Dai Didi — voice-first care guide

Talk instead of typing. The mother speaks in Hindi, Hinglish or English; Didi asks follow-ups, flags danger signs
with **fixed rules**, answers by voice, and writes a structured entry for her timeline. A phone-call mode gives
feature-phone users the same guide.

## The safety rule
**No language model decides urgency or writes any sentence Didi speaks.**
- Understanding = wording patterns in `shared/voice-triage.js` that map to the symptom codes already audited in
  `shared/emergency-triage.js` (single table). Spoken BP goes through the same vital rules (>=160/110 severe, >=140/90 high).
- Replies = pre-written templates (en / hi / hinglish). `isApprovedUtterance()` lets `/api/tts` speak only those,
  so arbitrary text can never be forwarded to Gemini.
- Ambiguity over-triages. "dard nahi ja raha" is not treated as a negation. A later "no" can clear a soft symptom
  but never silently drops an urgent code. A normal BP never cancels a symptom rule.
- Self-harm / harm-to-baby wording always escalates (112, Tele-MANAS 14416, "do not stay alone") in any context.
- Every saved entry records `decided_by: fixed_rules`, the rule ids that fired, and a clinician-review status.
  **Clinician review of every pattern and template (especially Hindi) is required before real-world use.**

## Pieces
| File | Role |
|---|---|
| `shared/voice-triage.js` | Pure engine (browser + Node + phone). `processTurn(state, text)` |
| `frontend/js/dai-didi.js/.css` | Panel: mic, live transcript, spoken reply, entry card, emergency hand-off, phone simulator |
| `frontend/js/care-extensions.js` | `openSOS(preset)` opens the existing emergency flow pre-filled |
| `backend/didiVoice.js` | Save/list/delete entries, doctor read, phone webhook |
| `backend/ivr/provider.js` | IVR interface: `stub` (demo), `twilio` (TwiML + signature check), `exotel` (placeholder) |
| `backend/db/didi_voice.sql` | `voice_care_entries` (registered in seed-local / check-local) |
| `backend/didiVoice.test.js` | 19 tests |

## Demo script
1. Dashboard -> **Dai Didi** (bottom-left). Language Hindi.
2. Tap the mic and say *"sir dard hai aur nazar dhundhli hai"* (or tap the demo chip).
3. Didi flags emergency + a *possible pre-eclampsia warning* (a warning, not a diagnosis), speaks the reply,
   asks for a BP reading **after** telling her to call 112, and opens the emergency flow pre-filled.
4. Answer *"150 by 100"* -> BP is echoed, the entry card shows BP + rule ids, **Save to my timeline**.
5. Phone mode: expand *Phone call mode*, Dial, press 1, speak the same sentence.

## Config
- Voice out: existing `GEMINI_API_KEY` (+ optional `GEMINI_TTS_MODEL/VOICE`). Without it the browser's own
  Hindi voice is used and labelled as a fallback.
- Voice in: browser speech recognition (Chrome/Edge/Safari; audio may be processed by the browser vendor).
  Typing always works.
- Phone: stub is on outside production (`DAI_IVR_STUB=true` to force on). Twilio: `TWILIO_AUTH_TOKEN`,
  `PUBLIC_BASE_URL`, point the number's voice webhook to `POST /api/didi/ivr/twilio`.
  Callers are matched to a mother by phone number; unknown callers get guidance but nothing is saved.

## Known limits
- Hindi/Hinglish/English only. Marathi, Bengali, Tamil etc. need native-clinician-reviewed lexicon + templates (add to `LEX`/`T`).
- Spoken BP works with digits ("150 by 100"); Hindi number words ("ek sau pachas") are not parsed, Didi asks again.
- Entries are listed via `GET /api/didi/entries` and the doctor route; the timeline UI does not render them yet.
- Exotel adapter is a placeholder.
