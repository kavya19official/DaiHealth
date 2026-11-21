# Dhruv: simple 3D chat

The patient assistant has one launcher, its existing animated 3D avatar, a conversation, four suggested questions and exactly three modes:

- **Text → Text**: type a question; the reply remains text only.
- **Text → Voice**: type a question; Dhruv speaks the reply and keeps its text visible.
- **Voice ↔ Voice**: tap **Start conversation**, then speak. Dhruv replies and listens again after playback. The same button ends the conversation. Switching modes/languages, closing the assistant or hiding the page stops capture/playback and ignores stale results.

The screen no longer includes separate Didi controls, a phone simulator, structured-note/save forms, FAQ category accordions, AI-routing/provider panels, drafting forms, device-voice checkboxes, replay/speed controls or repeated explanatory paragraphs. Language selection and a compact privacy/safety info icon remain in the header. The avatar's required attribution remains beneath it. Useful workspace/source links may appear within relevant answers. SOS contact actions appear only for relevant existing rule-based guidance.

## Behind the simple interface

- Existing prepared educational answers run locally. Typed questions are not sent to a language model.
- The shared Hindi/Hinglish/English Didi engine still supplies fixed-rule symptom follow-ups and approved guidance. It does not diagnose, set clinician risk status or close care gaps. Emergency guidance pauses the voice loop. Save-note prompts are omitted because this chatbot does not save records.
- Microphone capture uses browser speech recognition, which may use its vendor's service. Safari/Chrome/Brave support depends on browser/version/language. Service failures, permissions and missing microphones have distinct messages.
- Spoken approved replies use existing Gemini TTS. If it fails, a contextual **Use device voice** action allows an explicit switch to the browser's voice. No silent substitution occurs. Transcript text remains visible.
- Care-guide replies bypass public audio caches/coalescing; public FAQs retain bounded reuse. No new consent, permission or schema changes were introduced.
- Unsaved conversation state stays in memory. This screen never writes clinical notes or submits external AI drafting requests. Existing protected backend note, IVR and drafting APIs remain available to their integrations.
- The optional avatar respects low-bandwidth and reduced-motion preferences. Essential chat does not require 3D.

Internal `DaiDidi` names, `/api/didi/*` endpoints, `DaiDidiUI` and the `#dai-didi` link remain compatible; the patient-visible assistant is Dhruv.

## Verification

```bash
node --test backend/dayaSpeech.test.js backend/dayaAssistant.test.js backend/didiVoice.test.js backend/patientTimelineClient.test.js
NODE_PATH=/path/to/jsdom/node_modules node scripts/test-unified-dhruv.cjs
NODE_PATH=/path/to/playwright-core/node_modules node scripts/test-unified-dhruv-browser.cjs
npm test --prefix backend
```

Browser tests load the actual 3D assets but simulate recognition and audio. They cover desktop/mobile, English/Hindi, light/dark, mode behaviour, stop/close guards and no automatic saves. Screenshots go to `/tmp/dai-simple-dhruv`. Real microphones, native language voices, live Gemini quota/latency and telephone delivery require separate manual validation.

Safari playback uses one reused audio element, activated from the voice-mode/start/send gesture. If playback is still rejected with `NotAllowedError`, a contextual **Play reply** button plays the already prepared audio on a direct click. It does not regenerate speech or silently switch voice providers. Ending/closing discards pending playback. Automated tests include a real WAV player with simulated autoplay rejection; actual Safari user permissions still require manual confirmation.

Voice-design update: voice mode uses Dhruv-only branding, the existing 3D avatar, a circular microphone control with rings, labelled user/Dhruv bubbles, transient speech transcription and compact replay controls. The waveform is a decorative interaction animation driven by actual listening/preparing/speaking/paused/error states, not a measured audio-level graph. Reduced-motion preferences disable animation. The visual reference’s saved-record confirmation, doctor submission and telephone-call claims are not reproduced: this screen still does not automatically save or send clinical records. The three modes and four suggested questions remain.
