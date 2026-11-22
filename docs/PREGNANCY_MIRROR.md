# Pregnancy mirror: educational camera prototype

Open **Patient → Pregnancy mirror** in the sidebar, or `dashboard.html#pregnancy-mirror`. The experience has its own full patient page and no Home button; no backend route, record, permission or consent model has changed.

## Included

- Original educational Three.js cutaway geometry with muted tissue colours, fine surface relief, conforming placental vessels and a softly coiled cord: uterus, placenta, baby and umbilical cord; an optional twins example. Twins mode does not infer plurality or placental arrangement from a patient record.
- Geometry-linked, labelled hotspots that highlight a structure and start its prepared Dhruv explanation; layer buttons and a stage-mounted reveal handle. The explanation and transcript remain below the model, with mute and replay controls.
- An illustrative 12–40-week slider. It changes schematic proportions, not clinical growth measurements. Key week ticks and trimester labels provide orientation. Exploration has a distinct visual state, with a return-to-recorded-week pill. A valid recorded due date supplies the week when a starting date is absent; no date is invented. Missing dates link to the profile, and postpartum accounts remain in an explicitly educational view. “My recorded week” uses the existing stage calculation only for an ongoing pregnancy within that range. Postpartum, missing and out-of-range weeks remain unavailable.
- Front camera after one “Use my camera” action and browser permission, with the on-device/no-upload explanation beside the button. MediaPipe Pose Landmarker Lite runs in a worker on this device. Torso landmarks position the illustration; they do not estimate pregnancy, anatomy, fetal position, size or health.
- A taller, wider standing-camera view, plus an optional expanded/fullscreen capture view. Camera controls, alignment hints and hand status stay outside the image; the preview keeps only compact badges and its small educational watermark. Fullscreen retains SOS, replay and a collapsible transcript.
- Mirrored cover-crop coordinates, confidence filtering, smoothed placement and inference capped at approximately eight frames per second. Tracking pauses when hidden; the camera is turned off. Loading the runtime and model is deferred until camera tracking is requested.
- Manual drag and keyboard placement, a centring/size adjustment group, and a drag hint dismissed on first drag. Missing or off-screen shoulder/hip landmarks hide an uncalibrated overlay instead of leaving it on the face. Manual placement can explicitly restore a movable overlay; camera denial, missing APIs or tracking failure preserve the standalone illustration.
- Dhruv layer commands by typing or optional browser speech recognition. Prepared explanations use the existing Gemini TTS service with **Charon**, including replay, mute, language-specific caching and Safari-style playback recovery. The server accepts only the closed public mirror-narration catalogue; it never forwards camera frames, patient dates or free-form questions. Mirror narration explicitly selects Charon without changing the configured voice for other FAQ content. The text is fixed rather than generated. Device voice is offered only as an explicit fallback after a Charon failure. Voice input is separately disclosed because a browser may use a remote speech service. Existing Dhruv commands also recognise layers while the mirror is open.
- Optional **Control layers with my hand** uses the official MediaPipe Hand Landmarker float16 v1 model in the existing worker. It loads only after opt-in. An open palm held steadily for 800 ms peels one layer; lowering/relaxing the hand for at least 450 ms rearms it. A held fist restores all layers. Cooldown and stale-frame checks prevent repeated peels from one held hand or stalled inference. The sequence hides the uterus wall, placenta and cord; the baby always remains. **Peel a layer / Restore all** provide the same controls without a camera. Hand processing continues with manual body placement. Frames stay local, and disabling the controls closes the hand task. With hands active, the frame loop runs at most five times per second and body inference is skipped on alternating frames.
- Local PNG export combining the mirrored camera and overlay, with **“Educational illustration—not your scan”** permanently drawn into the PNG. A visible download link supports browsers that do not start the automatic download.
- SOS reuses the existing emergency action. The page keeps the app’s single SOS button; a modal temporarily hides the background SOS and restores it on close. Phone controls use a keyboard-accessible, pull-up bottom sheet. An explicit reduced-motion switch starts from the system preference. Closing, navigation, hiding the page or revoking camera consent stops media tracks and terminates the tracking worker. Photos, frames and landmarks are not persisted or sent to the server.

## Dependencies

Existing vendored Three.js 0.186.0 is reused. MediaPipe Tasks Vision **0.10.32** and Google's **Pose Landmarker Lite float16 v1** are vendored under `frontend/vendor/mediapipe`, with a license and notice. Both SIMD and compatibility runtimes and the optional hand model are included, approximately 35 MiB on disk; the browser selects a runtime. These files are not loaded on the patient homepage.

Official API reference: https://developers.google.com/edge/api/mediapipe/js/tasks-vision.poselandmarker

Official model: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

## Verification

```
node --test backend/pregnancyMirror.test.js
node scripts/test-pregnancy-mirror-browser.cjs
```

The browser check needs `playwright-core` and a Chrome executable; `DAI_TEST_BROWSER` can override the executable. It serves isolated synthetic fixtures and grants access only to Chrome's generated fake camera. It checks real local WASM/model inference, crop/placement logic, consent, camera denial and revocation, keyboard controls, recorded-week separation, twins disclosure, PNG downloads, no upload requests, English/Hindi, light/dark, reduced motion, and desktop/mobile layout. Artifacts go to `/private/tmp/dai-pregnancy-mirror`.

The separate DAI sidebar page is also checked in an isolated guest browser at 1440, 1024 and 390 pixels. Existing Dhruv tests cover its original three modes.

## Remaining evaluation

Actual palm/fist recognition, torso tracking and positioning require hands-on tests with consenting users, varied clothing, lighting, body types and mid-range phones. Safari's camera, worker and speech support needs real-device verification; manual placement remains the fallback. The generated-camera test proves the runtime executes, not that real-person tracking is stable. The geometry is a learning schematic, not an anatomically validated or personalised model. Clinical review of the educational content and visual proportions is still needed before a public rollout.

Hand model source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Gesture tests combine real local model loading/inference on a generated camera stream with deterministic hand-landmark fixtures for the UI hold/rearm/peel/reset flow. This does not claim validation of gesture accuracy on real hands or Android devices. The natural-style render is still an original educational illustration, not a medical photograph or a clinically validated anatomical asset.

Charon validation: backend tests cover the fixed narration catalogue, language, forced voice selection, cache and rejection of appended private text. Browser checks cover actual WAV playback, one reusable audio player, blocked-playback replay without another synthesis request, mute, explicit device fallback, larger camera bounds, buttons outside the preview and fullscreen. A public fixed uterus explanation was also verified against the running local Gemini service (Charon WAV); no patient record or image was used.

Layer transitions now deform the original structure geometry with a travelling curl and forward lift before fading away. Vessels share their placenta's deformation; restoration reverses the same progress and a new gesture retargets from the current frame. Animation runs only during a transition, cancels on disposal, and respects both the system and in-page reduced-motion choice. This is an educational visual transition, not a depiction of a medical procedure. Browser regression checks sample intermediate canvas frames, interrupted restoration and static reduced-motion behavior.


Expanded learning anatomy: uterus → amniotic sac → amniotic fluid → placenta → umbilical cord → baby. These are explorable structures/volumes, not a claim that all six are physically nested tissue layers or a surgical sequence. The membrane curls away; the fluid fades as a volume. New English/Hindi educational copy follows Johns Hopkins anatomy information (https://www.hopkinsmedicine.org/health/wellness-and-prevention/anatomy-fetus-in-utero) and MedlinePlus amniotic-fluid information (https://medlineplus.gov/ency/article/002220.htm). Copy and original schematic geometry still need clinician review before public clinical use.

“Explain this part aloud”, typed explanation requests, and browser speech recognition select only fixed public explanations. “Explain this part” uses the selected structure or the next structure exposed by the current cutaway. Named explanations never reset the cutaway. Charon receives only allowlisted narration, not the user's utterance, camera data or patient record. Tests cover the six hotspots, five reveal steps, microphone-result handling with synthetic recognition, preservation of peeled state, both language catalogues, rejected assessment requests, and real local Charon output for the new sac explanation. Real-person speech recognition accuracy remains browser/device dependent.
