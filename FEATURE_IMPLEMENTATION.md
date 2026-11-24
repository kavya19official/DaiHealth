# New Features Implementation

This document describes the two new features added to the patient-facing application:

## D. Personalised Care Timeline

### Overview
An enhanced, stage-aware checklist generated from verified clinical guidance and clinician-approved care plans. It shows upcoming visits, tests, postpartum reviews, and child preventive-care milestones.

### Key Features
- **Stage-Aware Filtering**: Automatically filters milestones based on gestational age (calculated from LMP/EDD)
- **Versioned Guidance**: Tracks all clinician edits with an audit trail
- **Gestational Age Display**: Shows current pregnancy stage (e.g., "12w 3d · Trimester 2")
- **Edit History**: Patients can view when and why clinicians modified their care plan
- **Custom Milestones**: Clinicians can add personalized milestones

### Backend Implementation
- **New API Endpoints**:
  - `GET /api/timeline/enhanced` - Get personalised timeline with gestational age
  - `PATCH /api/timeline/:id/edit` - Clinician edit milestone (doctor only)
  - `POST /api/timeline/custom` - Add custom milestone (doctor only)
  - `GET /api/timeline/:id/edits` - View edit history
  - `PATCH /api/timeline/:id/complete-verified` - Mark complete with verification details

- **Database Tables**:
  - `care_timeline_edits` - Tracks all clinician edits with versioning

### Frontend Implementation
- **Files Added**:
  - `frontend/js/care-timeline-enhanced.js` - Enhanced timeline UI logic
  - `frontend/css/care-timeline-enhanced.css` - Styling for enhanced timeline

- **Integration**:
  - Integrated into the existing "Care timeline" panel in dashboard.html
  - Shows gestational age badge when LMP/EDD is known
  - Displays edit count indicator for modified milestones
  - Modal popup for viewing edit history

### Usage
1. **Patient View**:
   - Navigate to "Care timeline" in the sidebar
   - View gestational age and current stage at the top
   - See milestones grouped by pregnancy stage
   - Click "View edit history" on modified milestones to see clinician changes
   - Mark milestones as complete with optional verification details

2. **Clinician View** (Doctor):
   - Use `PATCH /api/timeline/:id/edit` to modify milestone titles, guidance, or due dates
   - Use `POST /api/timeline/custom` to add personalized milestones for specific patients
   - All edits are logged with reason and timestamp

---

## E. Missed-Care Outreach Queue

### Overview
A prioritised queue for hospital staff and community health workers to identify and follow up with patients who need care. Staff can log attempts, outcomes, and next actions.

### Key Features
- **Priority Scoring**: Automatically calculates priority based on urgency level and days overdue
- **Urgency Levels**: Critical (>30 days), High (>14 days), Medium (>7 days), Low (≤7 days)
- **Access Barriers**: Track barriers like transportation, cost, language, etc.
- **Outreach Logging**: Record call, visit, or message attempts with outcomes
- **Status Tracking**: Track items as pending, in progress, resolved, or deferred
- **Summary Dashboard**: Quick view of counts by urgency level

### Backend Implementation
- **New API Endpoints**:
  - `GET /api/patient/missed-care` - Patient view of their own missed care items
  - `GET /api/outreach/queue` - Staff view of prioritized outreach queue
  - `GET /api/outreach/:missedCareId/attempts` - View outreach attempts for an item
  - `POST /api/outreach/:missedCareId/attempts` - Log a new outreach attempt
  - `PATCH /api/outreach/:missedCareId/status` - Update missed care item status
  - `POST /api/outreach/generate` - Auto-generate missed care items from overdue milestones/appointments

- **Database Tables**:
  - `missed_care_items` - Tracks missed milestones and appointments with priority scoring
  - `outreach_attempts` - Logs all outreach attempts with outcomes
  - `care_timeline_edits` - Shared with enhanced timeline for edit tracking

- **Priority Scoring Algorithm**:
  ```
  Priority Score = (Urgency Weight × 10) + Overdue Days
  Where urgency weights: critical=4, high=3, medium=2, low=1
  ```

### Frontend Implementation
- **Files Added**:
  - `frontend/js/missed-care-outreach.js` - Outreach queue UI logic
  - `frontend/css/missed-care-outreach.css` - Styling for outreach queue

- **Integration**:
  - New "Outreach queue" panel in dashboard sidebar (for staff/doctors)
  - Enhanced "Care timeline" panel now includes "Missed Care Items" section for patients
  - Summary cards showing counts by urgency level
  - Filter controls for status, urgency, and limit
  - Modal dialog for logging outreach attempts

### Usage
1. **Patient View**:
   - Navigate to "Care timeline" in the sidebar
   - Scroll to "Missed Care Items" section
   - View overdue care items with urgency indicators
   - Click "Reschedule" to book a new appointment
   - Click "Mark resolved" if care has been received

2. **Staff/Doctor View**:
   - Navigate to "Outreach queue" in the sidebar
   - View summary counts by urgency level
   - Apply filters to narrow down the queue
   - Click "Generate Missed Care Items" to auto-populate from overdue milestones
   - Click "Log attempt" to record outreach (call, visit, message)
   - Fill in outcome, notes, and next action
   - Click "View history" to see all previous attempts for a patient

3. **Auto-Generation**:
   - Call `POST /api/outreach/generate` to automatically create missed care items from:
     - Overdue milestones (not completed, due date in the past)
     - Cancelled or pending appointments (requested date in the past)
   - This can be run as a scheduled job (e.g., daily cron)

---

## Database Migration

To apply the new database schema changes:

```bash
# For PostgreSQL (production/Render)
psql "$DATABASE_URL" -f backend/db/missed_care_outreach.sql

# For local development (if using DAI_LOCAL=true)
npm start  # The migration is automatically applied via seed-local.cjs
```

The migration is idempotent and can be safely re-run.

---

## File Structure

### Backend
```
backend/
├── server.js                          # Updated to register new route handlers
├── careTimelineEnhanced.js            # New: Enhanced timeline API
├── missedCareOutreach.js              # New: Outreach queue API
└── db/
    └── missed_care_outreach.sql       # New: Database schema
```

### Frontend
```
frontend/
├── dashboard.html                     # Updated: Added new panels and nav items
├── css/
    ├── care-timeline-enhanced.css     # New: Enhanced timeline styles
    └── missed-care-outreach.css       # New: Outreach queue styles
└── js/
    ├── care-timeline-enhanced.js      # New: Enhanced timeline UI
    ├── missed-care-outreach.js        # New: Outreach queue UI
    └── patient-dashboard.js          # Updated: Integration hooks
```

### Scripts
```
scripts/
└── seed-local.cjs                     # Updated: Added migration to list
```

---

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] Enhanced timeline loads and displays gestational age
- [ ] Milestones are filtered by stage when LMP/EDD is known
- [ ] Edit history modal displays correctly
- [ ] Missed care items appear in patient timeline
- [ ] Outreach queue loads for staff/doctors
- [ ] Priority scoring works correctly
- [ ] Outreach attempt dialog submits successfully
- [ ] Filters apply correctly to outreach queue
- [ ] Auto-generation creates missed care items from overdue milestones
- [ ] Responsive design works on mobile devices

---

## Future Enhancements

### Personalised Care Timeline
- Add more clinical guidance sources (WHO, national guidelines)
- Support multiple pregnancy tracking (twins, triplets)
- Add reminder notifications for upcoming milestones
- Export timeline as PDF for offline use

### Missed-Care Outreach Queue
- Add SMS/WhatsApp integration for outreach
- Include risk factors in priority scoring
- Add assignment system (assign specific staff to patients)
- Generate outreach reports and analytics
- Add bulk actions for multiple patients

## Doctor care workbench (24 November 2026)

Open **Doctor → Care tools** (`/doctor.html#care-tools`). The existing dashboard,
white surfaces, lavender top banner and floating Dhruv remain in place.

- **Maternal registries:** live views over the authorised assigned roster, saved
  stage/attention filters, chart links and current-authorisation CSV export.
  Child mode directs users to separate child records. Saved registries store
  filter definitions rather than snapshots of patient charts.
- **Clinic flow:** explicit clinic hours, candidate schedule openings, recorded
  waiting times, overlap/untimed warnings and confirmed maternal follow-up
  booking through the existing server-side access/conflict checks. Suggestions
  do not reserve rooms or confirm clinical urgency. Booking supports 30-minute
  follow-ups; alternate slot lengths are planning views.
- **Knowledge desk:** PubMed search links, editable evidence notebooks, source
  excerpts, findings and limitations. Optional Gemini highlights must match an
  exact supplied excerpt. This is source extraction, not independent literature
  verification or a medical recommendation engine.
- **Education studio:** editable handouts, presentation outlines, newsletters,
  blogs, video scripts and messages, with audience, language, campaign, planned
  date and references. Optional Gemini format/language adaptation requires
  explicit opt-in and a separate apply step. Numbers are checked against the
  source; clinical meaning and translation still require clinician review.
  Approved versions can be exported as text or printed/saved as PDF. Editing
  invalidates approval. Planned dates do not imply delivery.
- **Practice insights:** recorded appointment completion, cancellations,
  no-shows and repeat-visit counts over 30 days; aggregate inquiry/first-visit
  logs, goals and referral relationship notes. These are not measured retention,
  whole-practice financial results or automatic marketing attribution.
- **Connections:** an explicit integration checklist covering EMR/LIS/imaging,
  ABDM, drug safety, external messaging and clinical validation. No placeholder
  connection is presented as operational.

### Persistence and deployment

`backend/db/care_workbench.sql` is included in both local migration lists. Restart
with `npm run stop`, then `npm start`, to apply it locally. Production PostgreSQL
also needs this migration before enabling the new routes.

`GET/POST /api/doctor/workbench`, `PATCH/DELETE /api/doctor/workbench/:id` require
an authenticated verified doctor. Every item is owner-scoped, versioned and
server-persisted; create/edit/approve/delete events are recorded atomically.
Approval requires source references and explicit review. Education and evidence
are drafts until approved. Exports re-read the current saved version.

`POST /api/doctor/workbench/highlights` and `/adapt` reuse the existing
`DAI_CONSULTATION_AI_ENABLED`, `DAI_CONSULTATION_AI_MODEL` and `GEMINI_API_KEY`
configuration. Keys stay server-side. These actions send only user-selected
public content after explicit consent, have request deadlines and per-clinician
rate/concurrency controls, and do not save or approve output automatically.
Patient information must not be copied into these public-content tools.

### External work still required

Real hospital interoperability needs provider details, access agreements,
credentials, patient-matching and consent testing. ABDM needs sandbox onboarding
and conformance work; drug checks need an appropriate licensed database.
WhatsApp/email campaigns need a delivery provider, recipient consent, opt-outs
and delivery receipts. Clinical sign-off, a consented pilot, outcome measurement
and production load/security testing remain required before clinical deployment.
The local/synthetic workflows do not demonstrate reduced loss to follow-up.

### Checks

- `node --test backend/careWorkbench.test.js`
- `scripts/test-care-workbench-browser.cjs` exercises desktop/mobile registries,
  booking, evidence consent, proposed adaptation, approval, edit invalidation,
  exports, dark mode and viewport fit using synthetic data and a stub AI provider.
- Existing doctor navigation/dashboard browser checks remain applicable.
