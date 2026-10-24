# Smart Referral Handoff - Implementation Summary

## Overview
Implemented a complete cross-organisation referral workflow that allows clinicians to refer patients to hospitals, specialists, labs, or NICU facilities with acceptance/rejection tracking and summary return to the care team.

## Backend Implementation

### Database Schema (`backend/db/smart_referral_handoff.sql`)
- **referrals**: Main referral table with status tracking (pending, accepted, rejected, completed, cancelled)
- **referral_documents**: Attached documents for referrals
- **referral_communications**: Communication log with read/unread tracking
- **referral_permissions**: Permission-based access control (view, respond, full_access)

### API Endpoints (`backend/smartReferralHandoff.js`)
- `POST /api/referrals` - Create new referral (doctor only)
- `GET /api/referrals` - List referrals (sent/received)
- `GET /api/referrals/:id` - Get referral details with permissions check
- `PATCH /api/referrals/:id/decision` - Accept/reject referral (receiving facility/specialist)
- `POST /api/referrals/:id/summary` - Return patient summary to referring care team
- `GET /api/referrals/:id/communications` - Get communication history
- `POST /api/referrals/:id/communications` - Add communication message
- `PATCH /api/referrals/:id/communications/read` - Mark communications as read

## Frontend Implementation

### Files Added
- `frontend/js/smart-referral-handoff.js` - Referral UI logic
- `frontend/css/smart-referral-handoff.css` - Styling

### Integration Points
- Added "Referrals" panel to doctor dashboard (`frontend/doctor.html`)
- Navigation item with badge showing pending count
- Summary cards showing status breakdown
- Filter controls for status and referral type
- Modal dialogs for:
  - Creating new referrals
  - Accepting/rejecting with notes
  - Returning patient summaries
- Referral detail view with:
  - Full clinical information
  - Decision history
  - Communication thread
  - Real-time message sending

## Key Features

### 1. Permission-Based Access
- Only referring doctor can create referrals
- Only receiving facility/specialist can accept/reject
- Automatic permission granting to receiving party
- Communication limited to authorised parties

### 2. Status Tracking
- **Pending**: Awaiting decision
- **Accepted**: Receiving facility agreed to take patient
- **Rejected**: Receiving facility declined
- **Completed**: Summary returned to referring team
- **Cancelled**: Referral cancelled

### 3. Priority Levels
- **Routine**: Standard referral
- **Urgent**: Time-sensitive
- **Emergency**: Immediate attention required

### 4. Referral Types
- Hospital transfer
- Specialist consultation
- Laboratory testing
- NICU admission
- Radiology/imaging
- Other

### 5. Communication Thread
- Bidirectional messaging between parties
- Read/unread tracking
- Message types: note, question, answer, attachment
- Automatic status update notifications

### 6. Summary Return
- Receiving facility returns clinical summary
- Automatically marks referral as completed
- Summary visible to referring care team
- Timestamped for audit trail

## Usage Workflow

### For Referring Doctor:
1. Navigate to "Referrals" in doctor dashboard
2. Click "Create Referral"
3. Select patient, type, priority
4. Provide reason, diagnosis, clinical summary
5. Submit referral
6. Track status in referrals list
7. View communication thread
8. Receive summary when completed

### For Receiving Facility/Specialist:
1. View incoming referrals in list
2. Click "View Details" to see full information
3. Click "Accept" or "Reject" with notes
4. Optionally schedule appointment
5. Add communications as needed
6. When care is complete, click "Return Summary"
7. Provide summary of visit/findings
8. Referral marked as completed

## Security Considerations

1. **Patient Access Control**: Doctors can only refer patients they have an existing relationship with (via appointments)
2. **Permission Checks**: All API endpoints verify user permissions before allowing access
3. **Communication Privacy**: Messages only visible to authorised parties
4. **Audit Trail**: All decisions and communications are timestamped and logged

## Testing Checklist

- [x] Database migration created
- [x] Backend API implemented
- [x] Frontend UI created
- [x] Doctor dashboard integration
- [x] Permission-based access control
- [x] Status tracking workflow
- [x] Communication thread
- [x] Summary return feature
- [ ] Test creating referral as doctor
- [ ] Test accepting referral as receiving facility
- [ ] Test communication thread
- [ ] Test summary return
- [ ] Verify permission checks work correctly

## Next Steps

To complete testing:
1. Run database migration: `psql "$DATABASE_URL" -f backend/db/smart_referral_handoff.sql`
2. Restart backend server
3. Log in as a doctor
4. Navigate to Referrals panel
5. Test creating, accepting, and completing referrals
6. Verify permission controls
7. Test communication thread

## Account Creation Issue Note

The backend registration endpoint is working correctly (tested via curl). The issue appears to be in the frontend form submission in `auth.html`. The form submits to `/api/auth/register/mother` but there may be a JavaScript error or network issue preventing successful registration. Recommend checking browser console for errors when attempting to register.
