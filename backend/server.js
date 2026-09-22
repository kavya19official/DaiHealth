require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware


app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
      origin === 'https://daihealth.onrender.com' ||
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Concise request logging. Do not print cookies, authorization headers, or patient data.
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(cookieParser());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'anvaya',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
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
const MILESTONE_TEMPLATE = [
  { stage: 'Trimester 1', days: 42,  category: 'pregnancy', title: 'First antenatal visit & registration', guidance: null },
  { stage: 'Trimester 1', days: 70,  category: 'pregnancy', title: 'Blood work: HIV, syphilis & anaemia screening', guidance: 'Complete the pending blood work at the nearest lab — this screens for infections and anaemia that raise risk later in pregnancy.' },
  { stage: 'Trimester 1', days: 84,  category: 'pregnancy', title: 'Dating ultrasound', guidance: 'Book a dating ultrasound to confirm gestational age and rule out early complications.' },
  { stage: 'Trimester 2', days: 112, category: 'pregnancy', title: 'Second antenatal visit', guidance: 'Schedule the second antenatal visit — spacing between visits is how early warning signs get caught.' },
  { stage: 'Trimester 2', days: 140, category: 'pregnancy', title: 'Anomaly scan', guidance: null },
  { stage: 'Trimester 2', days: 168, category: 'pregnancy', title: 'Glucose tolerance test', guidance: 'Take the glucose tolerance test to screen for gestational diabetes before the third trimester.' },
  { stage: 'Trimester 2', days: 196, category: 'pregnancy', title: 'Haemoglobin recheck & Anti-D', guidance: "Book a haemoglobin recheck. Anaemia is treatable now but raises delivery risk if it's still low at week 36." },
  { stage: 'Trimester 3', days: 210, category: 'pregnancy', title: 'Third-trimester check-up', guidance: null },
  { stage: 'Trimester 3', days: 238, category: 'pregnancy', title: 'Growth scan', guidance: null },
  { stage: 'Trimester 3', days: 252, category: 'pregnancy', title: 'Birth plan & facility readiness', guidance: 'Confirm the birth plan and facility readiness with your doctor before week 38.' },
  { stage: 'Delivery',    days: 280, category: 'pregnancy', title: 'Delivery', guidance: null },
  { stage: 'Postpartum',  days: 287, category: 'pregnancy', title: 'Postpartum check-up (mother)', guidance: null },
  { stage: 'Postpartum',  days: 322, category: 'pregnancy', title: 'Six-week postnatal visit', guidance: 'Attend the six-week postnatal visit — this is when postpartum recovery and mental health are screened.' },
  { stage: 'Child (0–1y)', days: 280, category: 'child', title: 'BCG, OPV-0 & Hepatitis-B birth dose', guidance: 'Visit the nearest PHC for the birth-dose vaccines (BCG, OPV-0, Hepatitis-B) — ideally within the first week.' },
  { stage: 'Child (0–1y)', days: 322, category: 'child', title: 'Penta-1, OPV-1 & Rotavirus-1', guidance: 'Book Penta-1, OPV-1 & Rotavirus-1 — protects against six serious childhood diseases.' },
  { stage: 'Child (0–1y)', days: 350, category: 'child', title: 'Penta-2, OPV-2 & Rotavirus-2', guidance: null },
  { stage: 'Child (0–1y)', days: 550, category: 'child', title: 'Measles-Rubella-1 & Vitamin A', guidance: null },
];

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

// Register Mother
app.post('/api/auth/register/mother', async (req, res) => {
  try {
    const b = req.body || {};
    const email = b.email;
    const password = b.password;
    const full_name = b.full_name;
    const phone = b.phone || null;
    const emergency_contact_name = b.emergency_contact_name || null;
    const emergency_contact_phone = b.emergency_contact_phone || null;
    const date_of_birth = b.date_of_birth || null;
    const address = b.address || null;
    const blood_group = b.blood_group || null;
    const pregnancy_status = b.pregnancy_status || 'pregnant';
    const lmp_date = b.lmp_date || null;
    const edd_date = b.edd_date || null;
    const gravida = b.gravida != null && b.gravida !== '' ? parseInt(b.gravida, 10) : null;
    const parity = b.parity != null && b.parity !== '' ? parseInt(b.parity, 10) : null;
    const previous_complications = b.previous_complications || null;
    const medical_conditions = b.medical_conditions || null;
    const allergies = b.allergies || null;
    const current_medications = b.current_medications || null;
    const height_cm = b.height_cm != null && b.height_cm !== '' ? Number(b.height_cm) : null;
    const pre_pregnancy_weight_kg = b.pre_pregnancy_weight_kg != null && b.pre_pregnancy_weight_kg !== '' ? Number(b.pre_pregnancy_weight_kg) : null;
    const systolic = b.systolic != null && b.systolic !== '' ? Number(b.systolic) : null;
    const diastolic = b.diastolic != null && b.diastolic !== '' ? Number(b.diastolic) : null;
    const blood_sugar = b.blood_sugar != null && b.blood_sugar !== '' ? Number(b.blood_sugar) : null;
    const child_full_name = b.child_full_name || null;
    const child_date_of_birth = b.child_date_of_birth || null;
    const child_gender = b.child_gender || null;
    const child_blood_group = b.child_blood_group || null;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!['pregnant', 'delivered', 'planning'].includes(pregnancy_status)) {
      return res.status(400).json({ error: 'Invalid pregnancy_status' });
    }
    if (pregnancy_status === 'delivered' && (!child_full_name || !child_date_of_birth)) {
      return res.status(400).json({ error: 'Child name and date of birth are required when already delivered' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [email, password_hash, 'mother']
      );
      const userId = userResult.rows[0].id;

      let careStartDate = new Date();
      if (lmp_date) {
        careStartDate = new Date(lmp_date + 'T00:00:00Z');
      } else if (edd_date) {
        careStartDate = new Date(new Date(edd_date + 'T00:00:00Z').getTime() - 280 * 86400000);
      }

      let ageYears = null;
      if (date_of_birth) {
        const dob = new Date(date_of_birth + 'T00:00:00Z');
        ageYears = Math.floor((Date.now() - dob.getTime()) / (365.25 * 86400000));
      } else if (b.age != null && b.age !== '') {
        ageYears = parseInt(b.age, 10);
      }

      let risk_level = null;
      let risk_factors = [];
      if (ageYears != null && systolic != null && diastolic != null) {
        try {
          const { assessRisk } = require('./riskAssessment');
          const assessment = assessRisk({
            age: ageYears,
            systolic,
            diastolic,
            blood_sugar,
            previous_complications: !!previous_complications,
            medical_conditions,
            gravida
          });
          if (!assessment.error) {
            risk_level = assessment.risk_level;
            risk_factors = assessment.factors || [];
          }
        } catch (e) {
          console.error('Risk at register:', e.message);
        }
      }

      await client.query(
        `INSERT INTO mother_profiles (
          user_id, full_name, phone, emergency_contact_name, emergency_contact_phone, care_start_date,
          date_of_birth, address, blood_group, pregnancy_status, lmp_date, edd_date,
          gravida, parity, previous_complications, medical_conditions, allergies, current_medications,
          height_cm, pre_pregnancy_weight_kg, risk_level, risk_factors, risk_assessed_at,
          pregnancy_confirmed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22::jsonb, CASE WHEN $21 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
          CASE WHEN $11 IS NOT NULL OR $12 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END
        )`,
        [
          userId, full_name, phone, emergency_contact_name, emergency_contact_phone, careStartDate,
          date_of_birth, address, blood_group, pregnancy_status, lmp_date, edd_date,
          gravida, parity, previous_complications, medical_conditions, allergies, current_medications,
          height_cm, pre_pregnancy_weight_kg, risk_level, JSON.stringify(risk_factors)
        ]
      );

      await seedCareMilestones(client, userId, careStartDate);

      if (pregnancy_status === 'delivered' && child_full_name && child_date_of_birth) {
        await client.query(
          `INSERT INTO children (mother_id, full_name, date_of_birth, gender, blood_group)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, child_full_name, child_date_of_birth, child_gender, child_blood_group || blood_group]
        );
      }

      if (systolic != null && diastolic != null) {
        await client.query(
          `INSERT INTO health_logs (mother_id, log_type, data, logged_at)
           VALUES ($1, 'blood_pressure', $2::jsonb, CURRENT_TIMESTAMP)`,
          [userId, JSON.stringify({ systolic, diastolic })]
        );
      }
      if (blood_sugar != null) {
        await client.query(
          `INSERT INTO health_logs (mother_id, log_type, data, logged_at)
           VALUES ($1, 'blood_glucose', $2::jsonb, CURRENT_TIMESTAMP)`,
          [userId, JSON.stringify({ mg_dl: Math.round(blood_sugar * 18), context: 'random' })]
        );
      }

      await client.query('COMMIT');

      const token = jwt.sign(
        { id: userId, email, role: 'mother' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.status(201).json({
        message: 'Mother registered successfully',
        user: {
          id: userId,
          email,
          role: 'mother',
          full_name,
          pregnancy_status,
          risk_level,
          has_child: pregnancy_status === 'delivered'
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/register/doctor', async (req, res) => {
  try {
    const { email, password, full_name, phone, specialization, medical_license_number, facility_name } = req.body;

    // Validation
    if (!email || !password || !full_name || !specialization || !medical_license_number) {
      return res.status(400).json({ error: 'Email, password, full name, specialization, and license number are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert user
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [email, password_hash, 'doctor']
      );

      const userId = userResult.rows[0].id;

      // Insert doctor profile
      await client.query(
        'INSERT INTO doctor_profiles (user_id, full_name, phone, specialization, medical_license_number, facility_name) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, full_name, phone, specialization, medical_license_number, facility_name]
      );

      await client.query('COMMIT');

      // Generate JWT token
      const token = jwt.sign(
        { id: userId, email, role: 'doctor' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // Set HTTP-only cookie
      const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

      res.status(201).json({
        message: 'Doctor registered successfully',
        user: {
          id: userId,
          email,
          role: 'doctor',
          full_name
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Doctor registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get user profile
    const profile = await getUserProfile(user.id, user.role);

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set HTTP-only cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: profile?.full_name || email.split('@')[0],
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
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.json({ message: 'Logout successful' });
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT id, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
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
  SELECT id, stage, category, title, guidance, due_date, completed_at, sort_order,
         CASE WHEN completed_at IS NOT NULL THEN 'completed'
              WHEN due_date < CURRENT_DATE THEN 'overdue'
              ELSE 'upcoming' END AS status
  FROM care_milestones
  WHERE mother_id = $1
  ORDER BY sort_order ASC`;

// Mother: fetch her own care timeline
app.get('/api/timeline', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const result = await pool.query(MILESTONE_SELECT, [req.user.id]);
    res.json({ milestones: result.rows });
  } catch (error) {
    console.error('Fetch timeline error:', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// Mother: mark one of her own milestones complete
app.patch('/api/timeline/:id/complete', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE care_milestones SET completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND mother_id = $2
       RETURNING id, completed_at`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Milestone not found' });
    }
    res.json({ message: 'Milestone marked complete', milestone: result.rows[0] });
  } catch (error) {
    console.error('Complete milestone error:', error);
    res.status(500).json({ error: 'Failed to update milestone' });
  }
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
    const motherId = parseInt(req.params.motherId, 10);
    if (Number.isNaN(motherId)) {
      return res.status(400).json({ error: 'Invalid patient id' });
    }

    const relation = await pool.query(
      'SELECT 1 FROM appointments WHERE doctor_id = $1 AND mother_id = $2 LIMIT 1',
      [req.user.id, motherId]
    );
    if (relation.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this patient' });
    }

    const profileResult = await pool.query(
      'SELECT full_name, phone, care_start_date FROM mother_profiles WHERE user_id = $1',
      [motherId]
    );
    const milestonesResult = await pool.query(MILESTONE_SELECT, [motherId]);

    res.json({ patient: profileResult.rows[0] || null, milestones: milestonesResult.rows });
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
    const motherId = parseInt(req.params.motherId, 10);
    if (Number.isNaN(motherId)) {
      return res.status(400).json({ error: 'Invalid patient id' });
    }

    const relation = await pool.query(
      'SELECT 1 FROM appointments WHERE doctor_id = $1 AND mother_id = $2 LIMIT 1',
      [req.user.id, motherId]
    );
    if (relation.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this patient' });
    }

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
app.post('/api/doctor/colleagues', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
  try {
    const { email, password, full_name, phone, specialization, medical_license_number, facility_name } = req.body;

    if (!email || !password || !full_name || !specialization || !medical_license_number) {
      return res.status(400).json({ error: 'Email, password, full name, specialization, and license number are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [email, password_hash, 'doctor']
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
  try {
    const { doctor_id, requested_date, reason } = req.body;
    if (!doctor_id || !requested_date) {
      return res.status(400).json({ error: 'Doctor and requested date are required' });
    }

    const doctorCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'doctor'",
      [doctor_id]
    );
    if (doctorCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected doctor not found' });
    }

    const result = await pool.query(
      `INSERT INTO appointments (mother_id, doctor_id, requested_date, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, doctor_id, requested_date, reason || null]
    );
    res.status(201).json({ message: 'Appointment requested', appointment: result.rows[0] });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Failed to request appointment' });
  }
});

// Mother or doctor: list their own appointments (never each other's)
app.get('/api/appointments', authenticateToken, authorizeRole(['mother', 'doctor']), async (req, res) => {
  try {
    let result;
    if (req.user.role === 'mother') {
      result = await pool.query(
        `SELECT a.*, dp.full_name AS doctor_name, dp.specialization
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
    res.json({ message: 'Appointment updated', appointment: result.rows[0] });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Mother dashboard: pregnancy profile, vitals/kick logs, reports
require('./motherDashboard')(app, { pool, authenticateToken, authorizeRole, MILESTONE_TEMPLATE });


// High-risk pregnancy assessment (Maternal Health Risk Data Set)
const { assessRisk } = require('./riskAssessment');

app.get('/api/risk', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id, 'mother');
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({
      risk_level: profile.risk_level || null,
      risk_factors: profile.risk_factors || [],
      risk_assessed_at: profile.risk_assessed_at || null,
      pregnancy_status: profile.pregnancy_status || null
    });
  } catch (e) {
    console.error('Get risk error:', e);
    res.status(500).json({ error: 'Failed to load risk' });
  }
});

app.post('/api/risk/assess', authenticateToken, authorizeRole(['mother']), async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id, 'mother');
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    let age = null;
    if (profile.date_of_birth) {
      const dob = new Date(profile.date_of_birth);
      age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 86400000));
    } else if (req.body.age != null) {
      age = Number(req.body.age);
    }

    // Prefer latest BP / glucose from health_logs
    const logs = await pool.query(
      `SELECT log_type, data FROM health_logs
       WHERE mother_id = $1 AND log_type IN ('blood_pressure', 'blood_glucose')
       ORDER BY logged_at DESC LIMIT 20`,
      [req.user.id]
    );
    let systolic = req.body.systolic != null ? Number(req.body.systolic) : null;
    let diastolic = req.body.diastolic != null ? Number(req.body.diastolic) : null;
    let blood_sugar = req.body.blood_sugar != null ? Number(req.body.blood_sugar) : null;
    let heart_rate = req.body.heart_rate != null ? Number(req.body.heart_rate) : null;
    let body_temp = req.body.body_temp != null ? Number(req.body.body_temp) : null;

    for (const row of logs.rows) {
      if (row.log_type === 'blood_pressure' && systolic == null) {
        systolic = row.data && row.data.systolic != null ? Number(row.data.systolic) : null;
        diastolic = row.data && row.data.diastolic != null ? Number(row.data.diastolic) : null;
        if (heart_rate == null && row.data && row.data.pulse != null) heart_rate = Number(row.data.pulse);
      }
      if (row.log_type === 'blood_glucose' && blood_sugar == null && row.data && row.data.mg_dl != null) {
        blood_sugar = Number(row.data.mg_dl) / 18; // mg/dL → mmol/L
      }
    }

    const assessment = assessRisk({
      age,
      systolic,
      diastolic,
      blood_sugar,
      body_temp,
      heart_rate,
      previous_complications: !!profile.previous_complications,
      medical_conditions: profile.medical_conditions,
      gravida: profile.gravida
    });
    if (assessment.error) return res.status(400).json({ error: assessment.error });

    await pool.query(
      `UPDATE mother_profiles
       SET risk_level = $2, risk_factors = $3::jsonb, risk_assessed_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [req.user.id, assessment.risk_level, JSON.stringify(assessment.factors)]
    );

    res.json({ assessment, saved: true });
  } catch (e) {
    console.error('Assess risk error:', e);
    res.status(500).json({ error: 'Risk assessment failed' });
  }
});

require('./children')(app, { pool, authenticateToken, authorizeRole });

// Hospital, doctor, and patient continuity workflows
require('./hospitalPlatform')(app);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the plain HTML frontend from the same Render service.
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use('/frontend', express.static(frontendPath));
app.use(express.static(frontendPath));
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`DAI backend server running on port ${PORT}`);
});
