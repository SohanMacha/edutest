require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || 'edutest_super_secret_key_2026';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Database connection
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'edutest',
  port: Number(process.env.DB_PORT) || 3306,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000
});

pool.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL Database successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database Connection Error:', err.message);
  });

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

// ----------------------------------------------------
// FACULTY ENDPOINTS
// ----------------------------------------------------

app.get('/api/faculty/stats', authenticateToken, async (req, res) => {
  try {
    const [tests] = await pool.query('SELECT COUNT(*) as totalTests FROM tests');
    const [students] = await pool.query('SELECT COUNT(DISTINCT student_id) as totalStudents FROM results');
    const [submissions] = await pool.query('SELECT COUNT(*) as totalSubmissions, AVG(percentage) as avgPassRate FROM results');
    
    res.json({
      totalTests: tests[0].totalTests,
      totalStudents: students[0].totalStudents,
      totalSubmissions: submissions[0].totalSubmissions,
      passRate: Math.round(submissions[0].avgPassRate || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/faculty/students', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.name, u.email, u.roll_number, u.phone, u.department, u.division_batch, u.semester,
      (SELECT COUNT(DISTINCT test_id) FROM results WHERE results.student_id = u.id) as tests_taken
      FROM users u WHERE u.role = 'student'
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/faculty/reports', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id as submission_id, r.score, r.total_marks, r.percentage, r.warnings_count, r.created_at,
             t.title as test_title, u.name as student_name, u.email as student_email, u.roll_number
      FROM results r
      JOIN tests t ON r.test_id = t.id
      JOIN users u ON r.student_id = u.id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/faculty/tests', authenticateToken, async (req, res) => {
  try {
    const { title, duration_mins, start_date, end_date, questions } = req.body;
    
    const [testResult] = await pool.query(
      'INSERT INTO tests (title, duration_mins, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?)',
      [title, duration_mins, start_date, end_date, req.user.id]
    );
    const testId = testResult.insertId;

    if (questions && questions.length > 0) {
      for (const q of questions) {
        await pool.query(
          'INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [testId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks || 1]
        );
      }
    }

    res.json({ message: 'Assessment created successfully', testId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Question Generator Endpoint with File/Document Support
app.post('/api/faculty/generate-ai-questions', authenticateToken, upload.single('materialFile'), async (req, res) => {
  try {
    const { topic, count = 3 } = req.body;
    const file = req.file;

    let contents = [];
    let prompt = `Generate exactly ${count} multiple-choice questions based on the provided material and topic: "${topic || 'General document content'}". 
    Each question must have 4 options (A, B, C, D) and specify the correct option letter (e.g., "A").
    You MUST return the response strictly as a JSON array of objects with the following keys:
    - question_text (string)
    - option_a (string)
    - option_b (string)
    - option_c (string)
    - option_d (string)
    - correct_option (string, e.g. "C")
    Do not include any markdown formatting like \`\`\`json in your response, just return the raw JSON array string.`;

    if (file) {
      const uploadedFile = await ai.files.upload({
        file: file.path,
        config: { mimeType: file.mimetype }
      });
      contents.push(uploadedFile);
    }

    contents.push(prompt);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    if (file && file.path) {
      fs.unlink(file.path, () => {});
    }

    let rawText = response.text.trim();
    if (rawText.startsWith('```json')) {
      rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const questions = JSON.parse(rawText);
    res.json({ questions });
  } catch (err) {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    console.error('AI Document Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate questions from file: ' + err.message });
  }
});

app.delete('/api/faculty/tests/:testId', authenticateToken, async (req, res) => {
  try {
    const testId = req.params.testId;
    await pool.query('DELETE FROM questions WHERE test_id = ?', [testId]);
    await pool.query('DELETE FROM results WHERE test_id = ?', [testId]);
    await pool.query('DELETE FROM tests WHERE id = ?', [testId]);
    res.json({ message: 'Assessment deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/faculty/submissions/:submissionId/reset', authenticateToken, async (req, res) => {
  try {
    const submissionId = req.params.submissionId;
    await pool.query('DELETE FROM results WHERE id = ?', [submissionId]);
    res.json({ message: 'Student submission reset successfully. Re-test allowed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// AUTHENTICATION & STUDENT ENDPOINTS
// ----------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = users[0];
    
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

app.post('/api/results', authenticateToken, async (req, res) => {
  try {
    const { test_id, answers, warnings_count } = req.body;
    const [questions] = await pool.query('SELECT id, correct_option, marks FROM questions WHERE test_id = ?', [test_id]);
    
    let score = 0;
    let total_marks = 0;
    
    const normalizedAnswers = {};
    if (answers) {
      for (const key of Object.keys(answers)) {
        normalizedAnswers[String(key)] = answers[key];
      }
    }

    for (const q of questions) {
      total_marks += (q.marks || 1);
      const studentAns = normalizedAnswers[String(q.id)];
      if (studentAns) {
        const sAnsStr = Array.isArray(studentAns) ? studentAns.map(s=>String(s).trim()).sort().join(',') : String(studentAns).trim();
        const cAnsStr = String(q.correct_option).trim();
        if (sAnsStr === cAnsStr) {
          score += (q.marks || 1);
        }
      }
    }

    const percentage = total_marks > 0 ? Math.round((score / total_marks) * 100) : 0;
    const answersJson = JSON.stringify(normalizedAnswers);

    const [insertRes] = await pool.query(
      'INSERT INTO results (test_id, student_id, score, total_marks, percentage, warnings_count, answers) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [test_id, req.user.id, score, total_marks, percentage, warnings_count || 0, answersJson]
    );

    res.json({ id: insertRes.insertId, score, total_marks, percentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, roll_number, phone, department, year_of_study, semester, division_batch, designation, specialization, role FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, department, designation, specialization } = req.body;
    await pool.query(
      'UPDATE users SET name=?, phone=?, department=?, designation=?, specialization=? WHERE id=?',
      [name, phone, department, designation, specialization, req.user.id]
    );
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});