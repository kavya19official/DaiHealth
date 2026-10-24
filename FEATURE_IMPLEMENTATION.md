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
