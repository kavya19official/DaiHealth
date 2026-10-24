from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
PROFILE=['age','week','distance_km','caregiver_support','prior_missed_visits','digital_literacy','preferred_channel']
FEATURES={'barrier':PROFILE,'reminders':PROFILE+['hour','channel'],'gaps':['days_overdue','gap_type','stage','clinician_priority','distance_km','caregiver_support'],'facilities':['distance_km','open_now','offers_service','days_since_confirmed','appointment_availability']}
TARGETS={'barrier':'missed','reminders':'action_completed','gaps':'closed_7d','facilities':'relevance'}
TABLES={'barrier':'appointments','reminders':'reminders','gaps':'gaps','facilities':'facilities'}
LABEL='Simulated on synthetic data'
