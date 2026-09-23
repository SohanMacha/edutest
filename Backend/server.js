require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || 'edutest_super_secret_key_2026';

// Database connection pool setup with cloud SSL support
const dbUri = process.env.DATABASE_URL;
const pool = dbUri 
  ? mysql.createPool({
      uri: dbUri,
      ssl: { rejectUnauthorized: false },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    })
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'edutest',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader.split(' '));
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Health check / Stats
app.get('/api/faculty/stats', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as totalTests FROM tests');
    res.json({ totalTests: rows[0].totalTests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.get('/api/auth/login', async (req, res) => {
  res.status(405).json({ error: 'Use POST for login' });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = users[0];
    
    // Support bcrypt or fallback comparison
    let valid = false;
    try { valid = await bcrypt.compare(password, user.password); } catch(e) {}
    if (!valid && password !== user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ token, role: user.role, name: user.name, userId: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global Timezone-Corrected Student Tests Query
app.get('/api/student/tests', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT t.*, 
        CASE 
          WHEN NOW() < DATE_SUB(t.start_date, INTERVAL 330 MINUTE) THEN 'UPCOMING'
          WHEN NOW() > t.end_date THEN 'EXPIRED'
          ELSE 'ACTIVE'
        END as test_state,
        COALESCE(r.score, 0) as score,
        CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as is_completed
      FROM tests t
      LEFT JOIN results r ON t.id = r.test_id AND r.student_id = ?
      ORDER BY t.created_at DESC
    `;
    const [rows] = await pool.query(query, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Questions for a test
app.get('/api/tests/:testId/questions', authenticateToken, async (req, res) => {
  try {
    const [questions] = await pool.query(
      'SELECT id, question_text, option_a, option_b, option_c, option_d, marks FROM questions WHERE test_id = ?',
      [req.params.testId]
    );
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit results
app.post('/api/results', authenticateToken, async (req, res) => {
  try {
    const { test_id, answers, warnings_count } = req.body;
    const [questions] = await pool.query('SELECT id, correct_option, marks FROM questions WHERE test_id = ?', [test_id]);
    
    let score = 0;
    let total_marks = 0;
    for (const q of questions) {
      total_marks += (q.marks || 1);
      const studentAns = answers[q.id];
      if (studentAns) {
        const sAnsStr = Array.isArray(studentAns) ? studentAns.map(s=>s.trim()).sort().join(',') : String(studentAns).trim();
        const cAnsStr = String(q.correct_option).trim();
        if (sAnsStr === cAnsStr) {
          score += (q.marks || 1);
        }
      }
    }

    const percentage = total_marks > 0 ? Math.round((score / total_marks) * 100) : 0;
    const [insertRes] = await pool.query(
      'INSERT INTO results (test_id, student_id, score, total_marks, percentage, warnings_count) VALUES (?, ?, ?, ?, ?, ?)',
      [test_id, req.user.id, score, total_marks, percentage, warnings_count || 0]
    );

    res.json({ id: insertRes.insertId, score, total_marks, percentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student History
app.get('/api/student/history', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT r.id as result_id, r.score, r.total_marks, r.percentage, r.warnings_count, r.created_at, t.title as test_title
      FROM results r
      JOIN tests t ON r.test_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `;
    const [rows] = await pool.query(query, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Review breakdown
app.get('/api/student/review/:resultId', authenticateToken, async (req, res) => {
  try {
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Profile endpoints
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, roll_number, phone, department, year_of_study, semester, division_batch, role FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, department, year_of_study, semester, division_batch } = req.body;
    await pool.query(
      'UPDATE users SET name=?, phone=?, department=?, year_of_study=?, semester=?, division_batch=? WHERE id=?',
      [name, phone, department, year_of_study, semester, division_batch, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});