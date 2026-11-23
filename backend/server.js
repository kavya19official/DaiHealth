require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const access = require('./accessControl');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { runRiskAssessment } = require('./riskService');
const careTimelineEnhanced = require('./careTimelineEnhanced');
const missedCareOutreach = require('./missedCareOutreach');
const greenHospitalDashboard = require('./greenHospitalDashboard');
const smartReferralHandoff = require('./smartReferralHandoff');

const app = express();
const PORT = process.env.PORT || 3001;

const demoGate = require('./hostedDemoGate').hostedDemoGate();
if (demoGate) app.use(demoGate.middleware);

// One local entry point; proxy before body parsing so uploads/auth stream intact.
const attachLocalUpgrade = require('./localGateway').registerLocalGateway(app);

// Middleware


const isSameHostOrigin = (origin, req) => {
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); }
  catch { return false; }
};
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  const allowed =
    !origin ||
    isSameHostOrigin(origin, req) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
    origin === 'https://daihealth.onrender.com' ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  if (!allowed) return callback(new Error('Not allowed by CORS'));
  callback(null, { origin: true, credentials: true });
}));

// Concise request logging. Do not print cookies, authorization headers, or patient data.
app.use((req, res, next) => {
  if (!(/^\/api\/(patient|doctor)\/(patients\/\d+\/)?ultrasound(?:\/|$)/.test(req.path))) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Hospital document ingestion accepts small base64 demo files. Keep a strict
// ceiling so uploads work locally without allowing unbounded request bodies.
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
// Private by default. Only explicitly public catalogues may opt into reuse.
app.use('/api', (req,res,next)=>{res.set('Cache-Control','private, no-store');next();});

// Database connection. Render Postgres exposes a DATABASE_URL; local development
// can still use DB_* values from backend/.env.
const hasDatabaseUrl = !!process.env.DATABASE_URL;
const hasDbParts = !!(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
const shouldUseSsl = process.env.DB_SSL === 'true'
  || (process.env.DB_SSL !== 'false' && process.env.NODE_ENV === 'production');
const dbConfig = hasDatabaseUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
    }
  : hasDbParts
    ? {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
      }
    : null;

const pool = process.env.DAI_LOCAL === 'true'
  ? require('./localPool').createLocalPool(process.env.DAI_LOCAL_DB_DIR)
  : dbConfig
  ? new Pool(dbConfig)
  : {
      query() {
        return Promise.reject(new Error('Database is not configured. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.'));
      },
      connect() {
        return Promise.reject(new Error('Database is not configured. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.'));
      }
    };

// Test database connection only when a database has actually been configured.
if (dbConfig || process.env.DAI_LOCAL === 'true') {
  pool.query('SELECT NOW()', (err, dbRes) => {
    if (err) {
      console.error('Database connection error:', err.message);
    } else {
      console.log('Database connected successfully at:', dbRes.rows[0].now);
    }
  });
} else {
  console.warn('Database not configured. Set DATABASE_URL on Render for login, dashboards, and patient data APIs.');
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let decoded;
  try { decoded=jwt.verify(token,JWT_SECRET); }
  catch { res.clearCookie('token');return res.status(401).json({error:'Invalid or expired token'}); }
  try {
    const active=(await pool.query('SELECT role,email_verification_required,email_verified_at FROM users WHERE id=$1 AND closed_at IS NULL',[decoded.id])).rows[0];
    if(!active || active.role !== decoded.role || (active.email_verification_required && !active.email_verified_at)){res.clearCookie('token');return res.status(401).json({error:'Account unavailable'});}
    req.user=decoded;next();
  } catch { return res.status(503).json({error:'Sign-in verification is temporarily unavailable. Please retry.'}); }
};

// Role-based authorization middleware
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Helper function to get user profile
const getUserProfile = async (userId, role) => {
  try {
    let profileQuery;
    if (role === 'mother') {
      profileQuery = 'SELECT * FROM mother_profiles WHERE user_id = $1';
    } else if (role === 'doctor') {
      profileQuery = 'SELECT * FROM doctor_profiles WHERE user_id = $1';
    } else {
      return null;
    }

    const result = await pool.query(profileQuery, [userId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
};

// ============================================================================
// Care Timeline: milestone template
// One continuous journey (antenatal -> delivery -> postpartum -> child's
// first year), expressed as day-offsets from a mother's care_start_date so
// due dates and overdue/upcoming status are always computed from real data,
// never hard-coded per patient.
// ============================================================================
const MILESTONE_TEMPLATE = require('./timelineRules').milestones;

// Seeds a mother's care timeline from the template above. Runs inside the
// same transaction as registration so a mother always has a timeline from
// the moment their account exists.
const seedCareMilestones = async (client, motherId, careStartDate) => {
  const insertText = `INSERT INTO care_milestones
    (mother_id, stage, category, title, guidance, due_date, sort_order)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`;

  for (let i = 0; i < MILESTONE_TEMPLATE.length; i++) {
    const m = MILESTONE_TEMPLATE[i];
    const dueDate = new Date(careStartDate.getTime() + m.days * 24 * 60 * 60 * 1000);
    await client.query(insertText, [motherId, m.stage, m.category, m.title, m.guidance, dueDate, i]);
  }
};

// Auth Routes

// Keep the existing patient profile and timeline initialization for verified signup.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isPlainDate = (s) => typeof s === 'string' && DATE_ONLY_RE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const cleanupStr = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const cleanupNum = (v, min, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const cleanupInt = (v, min, max) => {
  const n = cleanupNum(v, min, max);
  return n === null ? null : Math.round(n);
};

const BLOOD_GROUPS_RE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const cleanupBloodGroup = (v) => (typeof v === 'string' && BLOOD_GROUPS_RE.includes(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);
const PREGNANCY_STATUSES = ['pregnant', 'delivered', 'planning'];
// Registration's child-gender field is free text ("Optional" placeholder), so this is a
// best-effort normalisation onto the children table's sex CHECK ('female' | 'male' | 'other').
const normalizeChildSex = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (['female', 'girl', 'f'].includes(s)) return 'female';
  if (['male', 'boy', 'm'].includes(s)) return 'male';
  return 'other';
};

function preparePatientProfile(b) {
  return {
    phone: cleanupStr(b.phone, 20),
    emergencyContactName: cleanupStr(b.emergency_contact_name, 255),
    emergencyContactPhone: cleanupStr(b.emergency_contact_phone, 20),
    dateOfBirth: isPlainDate(b.date_of_birth) ? b.date_of_birth : null,
    address: cleanupStr(b.address, 500),
    bloodGroup: cleanupBloodGroup(b.blood_group),
    pregnancyStatus: PREGNANCY_STATUSES.includes(b.pregnancy_status) ? b.pregnancy_status : 'planning',
    lmpDate: isPlainDate(b.lmp_date) ? b.lmp_date : null,
    eddDate: isPlainDate(b.edd_date) ? b.edd_date : null,
    gravida: cleanupInt(b.gravida, 1, 20),
    parity: cleanupInt(b.parity, 0, 20),
    previousComplications: cleanupStr(b.previous_complications, 500),
    medicalConditions: cleanupStr(b.medical_conditions, 500),
    allergies: cleanupStr(b.allergies, 500),
    currentMedications: cleanupStr(b.current_medications, 500),
    heightCm: cleanupNum(b.height_cm, 100, 220),
    prePregnancyWeightKg: cleanupNum(b.pre_pregnancy_weight_kg, 25, 250),
    systolic: cleanupInt(b.systolic, 60, 260),
    diastolic: cleanupInt(b.diastolic, 30, 160),
    bloodSugarMmol: cleanupNum(b.blood_sugar, 1, 40),
    childName: cleanupStr(b.child_full_name, 120),
    childDate: isPlainDate(b.child_date_of_birth) ? b.child_date_of_birth : null,
    childSex: normalizeChildSex(b.child_gender),
    childBloodGroup: cleanupBloodGroup(b.child_blood_group)
  };
}

async function createVerifiedPatient(client, pending) {
  const p = pending.profile;
  const userId = (await client.query(
    `INSERT INTO users (email, password_hash, role, email_verification_required, email_verified_at)
     VALUES ($1, $2, 'mother', TRUE, clock_timestamp()) RETURNING id`,
    [pending.email, pending.password_hash]
  )).rows[0].id;
  let careStartDate = new Date();
  if (p.lmpDate) careStartDate = new Date(p.lmpDate);
  else if (p.eddDate) careStartDate = new Date(Date.parse(p.eddDate) - 280 * 86400000);

  await client.query(
    `INSERT INTO mother_profiles (
       user_id, full_name, phone, emergency_contact_name, emergency_contact_phone, care_start_date,
       date_of_birth, address, blood_group, pregnancy_status, lmp_date, edd_date, gravida, parity,
       previous_complications, medical_conditions, allergies, current_medications, height_cm, pre_pregnancy_weight_kg
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [userId, pending.full_name, p.phone, p.emergencyContactName, p.emergencyContactPhone, careStartDate,
     p.dateOfBirth, p.address, p.bloodGroup, p.pregnancyStatus, p.lmpDate, p.eddDate, p.gravida, p.parity,
     p.previousComplications, p.medicalConditions, p.allergies, p.currentMedications,
     p.heightCm, p.prePregnancyWeightKg]
  );

  const hasBloodPressure = p.systolic != null && p.diastolic != null;
  if (hasBloodPressure) {
    await client.query("INSERT INTO health_logs(mother_id,log_type,data) VALUES($1,'blood_pressure',$2)",
      [userId, JSON.stringify({ systolic:p.systolic, diastolic:p.diastolic, source:'self_reported_registration' })]);
  }
  if (p.bloodSugarMmol != null) {
    await client.query("INSERT INTO health_logs(mother_id,log_type,data) VALUES($1,'blood_glucose',$2)",
      [userId, JSON.stringify({ mg_dl:p.bloodSugarMmol*18.0182, context:'unspecified',
        source:'self_reported_registration', original_unit:'mmol/L', original_value:p.bloodSugarMmol })]);
  }
  if (hasBloodPressure || p.bloodSugarMmol != null) {
    await require('./clinicalReview').requestReview(client, userId, 'pregnancy_risk',
      'Review the self-reported measurements saved at registration. No automatic risk level was assigned.');
  }

  await seedCareMilestones(client, userId, careStartDate);
  const hasChild = p.pregnancyStatus === 'delivered' && Boolean(p.childName && p.childDate);
  if (hasChild) {
    await client.query(
      'INSERT INTO children (mother_id, name, date_of_birth, sex, blood_group) VALUES ($1, $2, $3, $4, $5)',
      [userId, p.childName, p.childDate, p.childSex, p.childBloodGroup]
    );
  }
  return { id:userId, email:pending.email, role:'mother', full_name:pending.full_name,
    pregnancy_status:p.pregnancyStatus, has_child:hasChild, email_verified:true };
}

function setLoginCookie(res, user) {
  const token = jwt.sign({ id:user.id, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:JWT_EXPIRES_IN });
  res.cookie('token', token, {
    httpOnly:true,
    secure:process.env.NODE_ENV === 'production',
    sameSite:process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge:7 * 24 * 60 * 60 * 1000
  });
}

require('./emailSignup')(app, { pool, preparePatientProfile, createVerifiedPatient, setLoginCookie });

app.use(require('./patientMLEvents')(pool));
// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    // Validation
    if (typeof email !== 'string' || !email.trim() || email.length > 320 || typeof password !== 'string' || !password || password.length > 1024) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const userResult = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email).trim()]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Verify password
    const validPassword = !user.closed_at && (!user.email_verification_required || (user.email_verified_at && Buffer.byteLength(password) <= 72)) &&
      await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get user profile
    const profile = await getUserProfile(user.id, user.role);

    setLoginCookie(res, user);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: profile?.full_name || email.split('@')[0],
        email_verified: Boolean(user.email_verified_at),
        ...profile
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout successful' });
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT id, email, role, created_at, email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const profile = await getUserProfile(user.id, user.role);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: profile?.full_name || user.email.split('@')[0],
        created_at: user.created_at,
        email_verified: Boolean(user.email_verified_at),
        ...profile
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// ============================================================================
// Care Timeline Routes (mother: own timeline · doctor: read-only, patients only)
// ============================================================================

const MILESTONE_SELECT = `
  SELECT id, stage, category, title, guidance, due_date, completed_at, sort_order, appointment_id, result_id, completion_verification, verified_facility_name,
         CASE WHEN completed_at IS NOT NULL THEN 'completed'
              WHEN due_date < CURRENT_DATE THEN 'overdue'
              ELSE 'upcoming' END AS status
  FROM care_milestones
  WHERE mother_id = $1
  ORDER BY sort_order ASC`;

// Mother: fetch her own care timeline
app.get('/api/timeline', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const result = await require('./timelineEventStore').current(pool,req.user.id);
    const careScanEntries = await require('./careScan').timelineEntries(pool, req.user.id);
    const allowed=['id','stage','category','title','guidance','due_date','completed_at','sort_order','appointment_id','result_id','completion_verification','verified_facility_name','status','workflow_state','clinician_priority','added_by_doctor_id'];
    res.set('Cache-Control','no-store').json({milestones:result.rows.map(row=>Object.fromEntries(allowed.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))),audit_checkpoint:result.checkpoint,care_scan_entries:careScanEntries});
  } catch (error) {
    console.error('Fetch timeline error:', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// Mother: mark one of her own milestones complete
app.patch('/api/timeline/:id/complete', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    let row=(await client.query('SELECT * FROM care_milestones WHERE id=$1 AND mother_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];
    if(!row){await client.query('ROLLBACK');return res.status(404).json({error:'Milestone not found'});}
    if(require('./careStepMachine').stateOf(row)==='planned'){
      await require('./careStepMachine').record(client,row,{type:'REPORT',owner:true},req.user.id);
      row=(await client.query("UPDATE care_milestones SET completed_at=NOW(),completion_verification='self_reported' WHERE id=$1 RETURNING *",[row.id])).rows[0];
    }
    await client.query('COMMIT');
    res.json({message:'Your update is recorded. Clinical confirmation is separate.',milestone:{id:row.id,completed_at:row.completed_at,workflow_state:require('./careStepMachine').stateOf(row)}});
  }catch(error){await client.query('ROLLBACK');res.status(error.status||500).json({error:'Could not record your update'});}
  finally{client.release();}
});

// ============================================================================
// Wellness Routes (mother: own data only)
// Every table is scoped by `log_date`, a plain DATE string (YYYY-MM-DD) the
// client supplies — the mother's own local calendar date, not the server's.
// That's what makes "today" reset at local midnight instead of at UTC
// midnight (5:30am IST), and it's why every route below requires `date`
// rather than computing it with CURRENT_DATE.
// ============================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (d) => typeof d === 'string' && DATE_RE.test(d);

// Mother: everything needed to render one day of the wellness dashboard
app.get('/api/wellness', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const date = req.query.date;
    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
    }

    const [nutrition, water, supplements, contractions, growth] = await Promise.all([
      pool.query('SELECT id, text, logged_at FROM nutrition_logs WHERE mother_id = $1 AND log_date = $2 ORDER BY logged_at ASC', [req.user.id, date]),
      pool.query('SELECT glasses FROM water_logs WHERE mother_id = $1 AND log_date = $2', [req.user.id, date]),
      pool.query('SELECT supplement, taken FROM supplement_logs WHERE mother_id = $1 AND log_date = $2', [req.user.id, date]),
      pool.query('SELECT id, started_at, duration_ms, gap_ms FROM contraction_logs WHERE mother_id = $1 AND log_date = $2 ORDER BY started_at ASC', [req.user.id, date]),
      pool.query('SELECT id, log_date, weight_kg, height_cm FROM growth_logs WHERE mother_id = $1 ORDER BY log_date ASC', [req.user.id]),
    ]);

    const supplementMap = {};
    supplements.rows.forEach((r) => { supplementMap[r.supplement] = r.taken; });

    res.json({
      nutrition: nutrition.rows,
      water_glasses: water.rows[0] ? water.rows[0].glasses : 0,
      supplements: supplementMap,
      contractions: contractions.rows,
      growth: growth.rows,
    });
  } catch (error) {
    console.error('Fetch wellness error:', error);
    res.status(500).json({ error: 'Failed to fetch wellness data' });
  }
});

// Mother: log a meal
app.post('/api/wellness/nutrition', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { date, text } = req.body;
    if (!isValidDate(date) || !text || !text.trim()) {
      return res.status(400).json({ error: 'A valid date and meal text are required' });
    }
    const result = await pool.query(
      'INSERT INTO nutrition_logs (mother_id, log_date, text) VALUES ($1, $2, $3) RETURNING id, text, logged_at',
      [req.user.id, date, text.trim()]
    );
    res.status(201).json({ meal: result.rows[0] });
  } catch (error) {
    console.error('Add nutrition error:', error);
    res.status(500).json({ error: 'Failed to log meal' });
  }
});

// Mother: add one glass of water for a given day (capped at 8)
app.post('/api/wellness/water', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { date } = req.body;
    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'A valid date is required' });
    }
    const result = await pool.query(
      `INSERT INTO water_logs (mother_id, log_date, glasses) VALUES ($1, $2, 1)
       ON CONFLICT (mother_id, log_date)
       DO UPDATE SET glasses = LEAST(water_logs.glasses + 1, 8)
       RETURNING glasses`,
      [req.user.id, date]
    );
    res.json({ water_glasses: result.rows[0].glasses });
  } catch (error) {
    console.error('Add water error:', error);
    res.status(500).json({ error: 'Failed to log water' });
  }
});

// Mother: set whether a supplement was taken on a given day
app.put('/api/wellness/supplements', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { date, supplement, taken } = req.body;
    if (!isValidDate(date) || !supplement) {
      return res.status(400).json({ error: 'A valid date and supplement name are required' });
    }
    await pool.query(
      `INSERT INTO supplement_logs (mother_id, log_date, supplement, taken) VALUES ($1, $2, $3, $4)
       ON CONFLICT (mother_id, log_date, supplement) DO UPDATE SET taken = $4`,
      [req.user.id, date, supplement, !!taken]
    );
    res.json({ supplement, taken: !!taken });
  } catch (error) {
    console.error('Update supplement error:', error);
    res.status(500).json({ error: 'Failed to update supplement' });
  }
});

// Mother: log a growth measurement (baby weight/height — historical, never resets)
app.post('/api/wellness/growth', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { date, weight, height } = req.body;
    if (!isValidDate(date) || weight == null || height == null) {
      return res.status(400).json({ error: 'A valid date, weight and height are required' });
    }
    const result = await pool.query(
      'INSERT INTO growth_logs (mother_id, log_date, weight_kg, height_cm) VALUES ($1, $2, $3, $4) RETURNING id, log_date, weight_kg, height_cm',
      [req.user.id, date, weight, height]
    );
    res.status(201).json({ measurement: result.rows[0] });
  } catch (error) {
    console.error('Add growth error:', error);
    res.status(500).json({ error: 'Failed to log growth measurement' });
  }
});

// The 5-1-1 rule: contractions about 5 minutes apart (gap), each lasting
// about a minute (duration), sustained for about an hour. We treat a
// contraction as matching if its gap is <=6min and duration is >=40s, then
// require a run of matching contractions whose total span is >=55 minutes.
const FIVE_ONE_ONE = { maxGapMs: 6 * 60 * 1000, minDurationMs: 40 * 1000, minSpanMs: 55 * 60 * 1000 };

function checkFiveOneOne(rowsAsc) {
  // rowsAsc: [{ started_at, duration_ms, gap_ms }], oldest first
  let runStart = null;
  for (let i = 0; i < rowsAsc.length; i++) {
    const r = rowsAsc[i];
    const matches = r.duration_ms >= FIVE_ONE_ONE.minDurationMs &&
      (r.gap_ms == null || r.gap_ms <= FIVE_ONE_ONE.maxGapMs);
    if (!matches) { runStart = null; continue; }
    if (runStart === null) runStart = new Date(r.started_at).getTime();
    const span = new Date(r.started_at).getTime() - runStart;
    if (span >= FIVE_ONE_ONE.minSpanMs) return true;
  }
  return false;
}

// Mother: log a contraction. The client sends its own gap (ms since the
// previous contraction's start) since only the client knows "no previous
// contraction today" vs "this really is the first one after midnight".
app.post('/api/wellness/contractions', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { date, started_at, duration_ms, gap_ms } = req.body;
    if (!isValidDate(date) || !started_at || duration_ms == null) {
      return res.status(400).json({ error: 'A valid date, start time and duration are required' });
    }
    const result = await pool.query(
      'INSERT INTO contraction_logs (mother_id, log_date, started_at, duration_ms, gap_ms) VALUES ($1, $2, $3, $4, $5) RETURNING id, started_at, duration_ms, gap_ms',
      [req.user.id, date, started_at, duration_ms, gap_ms == null ? null : gap_ms]
    );

    // Look at the last 2 hours of contractions (not just today's, so a
    // labour that starts just before midnight still gets evaluated properly)
    const recent = await pool.query(
      `SELECT started_at, duration_ms, gap_ms FROM contraction_logs
       WHERE mother_id = $1 AND started_at >= NOW() - INTERVAL '2 hours'
       ORDER BY started_at ASC`,
      [req.user.id]
    );
    const fiveOneOne = checkFiveOneOne(recent.rows);

    res.status(201).json({ contraction: result.rows[0], five_one_one: fiveOneOne });
  } catch (error) {
    console.error('Add contraction error:', error);
    res.status(500).json({ error: 'Failed to log contraction' });
  }
});

// ============================================================================
// Doctor Routes — scoped to patients who have booked an appointment with
// this doctor. A doctor can never read a mother who has no appointment
// relationship with them (enforced below, not just hidden in the UI).
// ============================================================================

// Doctor: roster of their own patients, with a live care-gap count
app.get('/api/doctor/patients', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT mp.user_id AS id, mp.full_name, mp.phone, mp.care_start_date,
              (SELECT COUNT(*) FROM care_milestones cm
                 WHERE cm.mother_id = mp.user_id
                   AND cm.completed_at IS NULL
                   AND cm.due_date < CURRENT_DATE) AS gap_count
       FROM appointments a
       JOIN mother_profiles mp ON mp.user_id = a.mother_id
       WHERE a.doctor_id = $1
         AND NOT ${access.revokedSql('a.mother_id', 'a.doctor_id', 'a.facility_uuid')}
       ORDER BY mp.full_name ASC`,
      [req.user.id]
    );
    res.json({ patients: result.rows });
  } catch (error) {
    console.error('Fetch doctor patients error:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Doctor: read one patient's timeline — only if that patient has an
// appointment with this doctor
app.get('/api/doctor/patients/:motherId/timeline', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    if(!await require('./clinicalDashboard').verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified clinician credentials are required'});
    const motherId = await access.gateDoctor(pool, req, res, 'timeline');
    if (motherId == null) return;

    const profileResult = await pool.query(
      'SELECT full_name, phone, care_start_date FROM mother_profiles WHERE user_id = $1',
      [motherId]
    );
    const milestonesResult = await pool.query(MILESTONE_SELECT, [motherId]);

    await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'doctor_timeline_read',jsonb_build_object('doctor_id',$2::int))",[motherId,req.user.id]);
    res.set('Cache-Control','no-store').json({ patient: profileResult.rows[0] || null, milestones: milestonesResult.rows });
  } catch (error) {
    console.error('Fetch patient timeline error:', error);
    res.status(500).json({ error: 'Failed to fetch patient timeline' });
  }
});

// Doctor: read one patient's wellness tracking — only if that patient has
// an appointment with this doctor. This is the "continuity" view: supplement
// adherence, recent contraction log, and whether the 5-1-1 threshold has
// been hit recently, so a doctor doesn't have to ask the mother to read her
// own app out loud over the phone.
app.get('/api/doctor/patients/:motherId/wellness', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const motherId = await access.gateDoctor(pool, req, res, 'wellness');
    if (motherId == null) return;

    const [adherence, recentContractions, allRecent] = await Promise.all([
      pool.query(
        `SELECT log_date,
                COUNT(*) FILTER (WHERE taken) AS taken_count,
                COUNT(*) AS total_count
         FROM supplement_logs
         WHERE mother_id = $1 AND log_date >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY log_date ORDER BY log_date DESC`,
        [motherId]
      ),
      pool.query(
        `SELECT id, started_at, duration_ms, gap_ms FROM contraction_logs
         WHERE mother_id = $1 ORDER BY started_at DESC LIMIT 20`,
        [motherId]
      ),
      pool.query(
        `SELECT started_at, duration_ms, gap_ms FROM contraction_logs
         WHERE mother_id = $1 AND started_at >= NOW() - INTERVAL '2 hours'
         ORDER BY started_at ASC`,
        [motherId]
      ),
    ]);

    const totalTaken = adherence.rows.reduce((sum, r) => sum + Number(r.taken_count), 0);
    const totalPossible = adherence.rows.reduce((sum, r) => sum + Number(r.total_count), 0);
    const adherencePct = totalPossible ? Math.round((totalTaken / totalPossible) * 100) : null;

    res.json({
      supplement_adherence_pct: adherencePct,
      supplement_days_tracked: adherence.rows.length,
      recent_contractions: recentContractions.rows,
      five_one_one_flag: checkFiveOneOne(allRecent.rows),
    });
  } catch (error) {
    console.error('Fetch patient wellness error:', error);
    res.status(500).json({ error: 'Failed to fetch patient wellness data' });
  }
});

// Doctor: list colleague doctors at the practice, for the "Care team" panel
app.get('/api/doctor/colleagues', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, dp.full_name, dp.specialization, dp.facility_name, dp.phone
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'doctor' AND u.id != $1
       ORDER BY dp.full_name ASC`,
      [req.user.id]
    );
    res.json({ colleagues: result.rows });
  } catch (error) {
    console.error('Fetch colleagues error:', error);
    res.status(500).json({ error: 'Failed to fetch colleagues' });
  }
});

// Doctor: add a new doctor to the platform (e.g. a colleague joining the
// practice). This creates a real, separately-loginable doctor account —
// it does not touch the requesting doctor's own session.
app.post(['/api/doctor/colleagues', '/api/auth/register/doctor'], authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const { email, password, full_name, phone, specialization, medical_license_number, facility_name } = req.body;

    if (!email || !password || !full_name || !specialization || !medical_license_number) {
      return res.status(400).json({ error: 'Email, password, full name, specialization, and license number are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [String(email).trim()]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const normalizedEmail = String(email).trim().toLowerCase();
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [normalizedEmail, password_hash, 'doctor']
      );
      const userId = userResult.rows[0].id;

      await client.query(
        'INSERT INTO doctor_profiles (user_id, full_name, phone, specialization, medical_license_number, facility_name) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, full_name, phone || null, specialization, medical_license_number, facility_name || null]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Doctor added',
        colleague: { id: userId, full_name, specialization, facility_name: facility_name || null, phone: phone || null }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add colleague error:', error);
    res.status(500).json({ error: 'Failed to add doctor' });
  }
});

// ============================================================================
// Appointments Routes
// ============================================================================

// Any authenticated user: list doctors, for a mother booking an appointment
app.get('/api/doctors', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, dp.full_name, dp.specialization, dp.facility_name
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'doctor'
       ORDER BY dp.full_name ASC`
    );
    res.json({ doctors: result.rows });
  } catch (error) {
    console.error('Fetch doctors error:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// Mother: request a new appointment
app.post('/api/appointments', authenticateToken, authorizeRole(['mother']), async (req, res) => {
 const continuity=require('./patientContinuity');const client=await pool.connect();let appointment;
 try {
  await client.query('BEGIN');
  const b=req.body||{};
  const lock=await client.query("SELECT id FROM users WHERE id=$1 AND role='doctor' FOR UPDATE",[b.doctor_id]);
  if(!lock.rows.length)throw Object.assign(new Error('Selected doctor not found'),{status:400});
  const ctx=await continuity.validateBooking(client,req.user.id,b);
  appointment=(await client.query(`INSERT INTO appointments(mother_id,doctor_id,requested_date,requested_time,reason,child_id,visit_type,milestone_id,facility_uuid,unit_uuid,unit_label,room,slot_end)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[req.user.id,b.doctor_id,b.requested_date,b.requested_time||null,String(b.reason||'Consultation').slice(0,2000),b.child_id||null,b.visit_type||null,b.milestone_id||null,ctx.facility_uuid||null,ctx.unit_uuid||null,ctx.unit_label||null,ctx.room||null,ctx.slot_end||null])).rows[0];
  if(b.milestone_id)await client.query('UPDATE care_milestones SET appointment_id=$1 WHERE id=$2 AND mother_id=$3',[appointment.id,b.milestone_id,req.user.id]);
  await continuity.queueBridge(client,appointment.id);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');return res.status(error.status||500).json({error:error.status?error.message:'Could not request this appointment'});}
 finally{client.release();}
 await continuity.syncBridge(pool).catch(e=>console.warn('Hospital mirror queued:',e.message));
 res.status(201).json({message:'Appointment requested; the clinic will confirm',appointment});
});

// Mother or doctor: list their own appointments (never each other's)
app.get('/api/appointments', authenticateToken, authorizeRole(['mother', 'doctor']), async (req, res) => {
  try {
    let result;
    if (req.user.role === 'mother') {
      result = await pool.query(
        `SELECT a.*, dp.full_name AS doctor_name, dp.specialization, dp.facility_name AS hospital_name
         FROM appointments a
         JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
         WHERE a.mother_id = $1
         ORDER BY a.requested_date DESC`,
        [req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT a.*, mp.full_name AS mother_name
         FROM appointments a
         JOIN mother_profiles mp ON mp.user_id = a.mother_id
         WHERE a.doctor_id = $1
         ORDER BY a.requested_date DESC`,
        [req.user.id]
      );
    }
    res.json({ appointments: result.rows });
  } catch (error) {
    console.error('Fetch appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Doctor: update the status of one of their own appointments
const VALID_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
app.patch('/api/appointments/:id/status', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, doctor_notes } = req.body;

    if (!VALID_APPOINTMENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      `UPDATE appointments SET status = $1, doctor_notes = COALESCE($2, doctor_notes)
       WHERE id = $3 AND doctor_id = $4
       RETURNING *`,
      [status, doctor_notes || null, id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    await require('./patientContinuity').queueBridge(pool,result.rows[0].id);
    await require('./patientContinuity').syncBridge(pool).catch(e=>console.warn('Hospital mirror queued:',e.message));
    res.json({ message: 'Appointment updated', appointment: result.rows[0] });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Mother dashboard: pregnancy profile, vitals/kick logs, reports
require('./motherDashboard')(app, { pool, authenticateToken, authorizeRole, MILESTONE_TEMPLATE });
require('./patientDaily')(app, { pool, authenticateToken, authorizeRole });
// Predictive risk trend, postpartum pathway, emergency response (db/care_extensions_v4.sql)
require('./careExtensions')(app, { pool, authenticateToken, authorizeRole });

// ============================================================================
// Maternal risk assessment (backend/riskAssessment.js) — mother-only, own data.
//
//   GET  /api/risk          the mother's last-saved assessment (or nulls if none yet)
//   POST /api/risk/assess   recompute from her stored profile + most recent vitals,
//                           save it, and return the full breakdown
// ============================================================================
app.get('/api/risk', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT risk_level, risk_factors, risk_assessed_at FROM mother_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Profile not found' });
    const row = r.rows[0];
    res.json({risk_level:null,risk_factors:[],risk_assessed_at:null,review_required:true,historical_record_present:!!row.risk_assessed_at,message:'Use clinician review decisions in Care timeline. Historical automated labels are not clinical approval.'});
  } catch (error) {
    console.error('Fetch risk error:', error);
    res.status(500).json({ error: 'Failed to load risk assessment' });
  }
});

app.post('/api/risk/assess', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const out = await runRiskAssessment(pool, req.user.id, req.body || {}, 'manual');
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('Assess risk error:', error);
    res.status(500).json({ error: 'Failed to run risk assessment' });
  }
});


// Child dashboard: child profiles (DOB, photo), per-child vaccines, growth and milestones
require('./childDashboard')(app, { pool, authenticateToken, authorizeRole });

// Notification Center: derived, deduped notifications for mothers and doctors
require('./notifications')(app, { pool, authenticateToken });

// Patient experience: notification prefs + privacy controls
require('./patientPreferences')(app, { pool, authenticateToken });
require('./birthReadiness').register(app, { pool, authenticateToken, authorizeRole });
require('./patientContinuity')(app, { pool, authenticateToken, authorizeRole });
require('./patientExperience')(app, { pool, authenticateToken, authorizeRole });
require('./patientHospitalStay')(app, { pool, authenticateToken, authorizeRole });
require('./patientHome')(app, { pool, authenticateToken, authorizeRole });
require('./postpartumInfant')(app, { pool, authenticateToken, authorizeRole });
require('./daicare')(app, { pool, authenticateToken, authorizeRole, startScheduler:true });
require('./sukoon')(app, { pool, authenticateToken, authorizeRole });
require('./clinicalContinuity')(app,{pool,authenticateToken,authorizeRole});
require('./qualityDashboard')(app,{pool,authenticateToken,authorizeRole});
require('./platformRights')(app,{pool,authenticateToken,authorizeRole});
require('./providerNotifications').register(app,{pool,authenticateToken,authorizeRole});
require('./patientSupport')(app, { pool, authenticateToken, authorizeRole });
const aiUsageTracker=require('./aiUsage').register(app,{pool,authenticateToken});
require('./patientML')(app, { pool, authenticateToken, authorizeRole,usageTracker:aiUsageTracker });
require('./clinicalDashboard')(app, { pool, authenticateToken, authorizeRole });
require('./consultationVoice').register(app, { pool, authenticateToken, authorizeRole });
require('./doctorWorkspace')(app, { pool, authenticateToken, authorizeRole });
require('./ultrasoundWorkspace')(app, { pool, authenticateToken, authorizeRole });
require('./doctorOperations')(app, { pool, authenticateToken, authorizeRole });
require('./patientDocuments')(app, { pool, authenticateToken, authorizeRole, jwtSecret: process.env.JWT_SECRET });
require('./patientTimelineLive')(app, { pool, authenticateToken, authorizeRole });
require('./timelineTrust')(app, { pool, authenticateToken, authorizeRole });
require('./timelineAccess')(app, { pool, authenticateToken, authorizeRole });
require('./pendingCare')(app, { pool, authenticateToken, authorizeRole });
require('./timelinePush').register(app, { pool, authenticateToken, authorizeRole, startScheduler:true });
require('./didiVoice').register(app, { pool, authenticateToken, authorizeRole });
require('./goldenHour').register(app, { pool, authenticateToken, authorizeRole });
require('./patientOfflineSync')(app, {pool,authenticateToken,authorizeRole});

// Enhanced care timeline and missed-care outreach
careTimelineEnhanced(app, { pool, authenticateToken, authorizeRole });
missedCareOutreach(app, { pool, authenticateToken, authorizeRole });

// Green hospital dashboard and smart referral handoff
greenHospitalDashboard(app, { pool, authenticateToken, authorizeRole });
smartReferralHandoff(app, { pool, authenticateToken, authorizeRole });

// Hospital, doctor, and patient continuity workflows
require('./hospitalPlatform')(app, { authenticateToken });

// Relational synthetic hospital and administration workspace.
require('./hospitalAdministration')(app);

// Facility discovery and doctor directory
require('./facilityDiscovery')(app, { pool, authenticateToken, authorizeRole });

// Smart referral handoff and mother-newborn continuity
require('./referralContinuity')(app, { pool, authenticateToken, authorizeRole });
require('./accessControl')(app, { pool, authenticateToken, authorizeRole });
require('./consentAudit')(app, { pool, authenticateToken, authorizeRole });
require('./followThrough')(app, { pool, authenticateToken, authorizeRole });
require('./privacyAnalytics')(app, { pool, authenticateToken, authorizeRole });
require('./demoCareMessages')(app, { pool, authenticateToken });
require('./visitSummary')(app, { pool, authenticateToken, authorizeRole });
require('./doctorFollowupAgent').register(app, { pool, authenticateToken, authorizeRole });

// Gemini receives approved Dr. Daya answers only; the API key remains server-side.
require('./clinicalReview').register(app,{pool,authenticateToken,authorizeRole});
require('./careCoordination')(app, { pool, authenticateToken, authorizeRole });
require('./googleAuth')(app, { pool, getUserProfile, seedCareMilestones, jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN });
require('./assistanceRouting').register(app,{pool,authenticateToken,usageTracker:aiUsageTracker});
app.post('/api/tts',(req,res,next)=>{try{req.user=jwt.verify(req.cookies.token,JWT_SECRET);}catch{}next();},require('./dayaSpeech').createSpeechHandler({usageTracker:aiUsageTracker}));

// Local-only diagnostics. No secrets or patient identifiers are returned.
if (process.env.DAI_LOCAL === 'true') {
  app.get('/api/local/status', async (req, res) => {
    try {
      const result = await pool.query("SELECT counts FROM dai_local_seed WHERE version='cohort-v1'");
      res.json({local:true, data_label:'Simulated on synthetic data', counts:result.rows[0]?.counts,
        accounts:{mother:'mother@dai-synthetic.invalid',doctor:'doctor@dai-synthetic.invalid',hospital:'hospital_admin@dai-synthetic.invalid'}, hospital_path:'/hospital-admin'});
    } catch (_) { res.status(503).json({error:'Local database setup incomplete. Run npm start from the DAI root.'}); }
  });
  app.get('/hospital.html', (req, res) => res.redirect('/hospital-admin'));
  app.get('/hospital-legacy.html', (req, res) => res.sendFile(path.join(__dirname,'../frontend/hospital.html')));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the plain HTML frontend from the same Render service.
const frontendPath = path.join(__dirname, '..', 'frontend');
// shared/child-reference.js is the one vaccination/milestone/growth schedule used by
// both the browser (window.AnvayaChild) and backend/childDashboard.js, so it's served
// here rather than copied into frontend/ where it could silently drift out of sync.
// Start directly at the familiar shared sign-in form, with no workspace chooser.
app.get(['/', '/index.html'], (req, res) => {
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect('/auth.html' + query);
});
const { staticCompression } = require('./staticCompression');
app.use('/shared', staticCompression(path.join(__dirname, '..', 'shared')), express.static(path.join(__dirname, '..', 'shared')));
app.use('/frontend', staticCompression(frontendPath), express.static(frontendPath));
app.use(staticCompression(frontendPath), express.static(frontendPath));

// Start server
const server = app.listen(PORT, demoGate || process.env.DAI_CONTAINER_DEMO === 'true' ? '0.0.0.0' : process.env.DAI_LOCAL === 'true' ? '127.0.0.1' : undefined, () => {
  const address = server.address();
  const port = address ? (typeof address === 'string' ? address : address.port) : PORT;
  console.log(`DAI backend server running on port ${port}`);
});

// The hosted demo uses the production Next server and has no dev websocket.
if (attachLocalUpgrade && !demoGate) attachLocalUpgrade(server);

if (process.env.DAI_LOCAL === 'true') {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      try { await pool.end(); process.exit(0); }
      catch (_) { process.exit(1); }
    });
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
