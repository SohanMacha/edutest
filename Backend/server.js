const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'edutest_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const JWT_SECRET = process.env.JWT_SECRET || 'edutest_super_secret_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// ================= AUTH ROUTES =================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, roll_number, email, password, role, faculty_passcode } = req.body;

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    if (role && role.toLowerCase() === 'faculty') {
      const SECRET_PASSCODE = 'EDUTEST_STAFF_2026';
      if (!faculty_passcode || faculty_passcode !== SECRET_PASSCODE) {
        return res.status(403).json({ error: 'Unauthorized: Invalid or missing faculty secret passcode.' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (name, roll_number, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [name, roll_number || null, email, hashedPassword, role || 'Student']
    );

    res.json({ message: 'Registration successful', userId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      role: user.role,
      name: user.name,
      userId: user.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= USER PROFILE ROUTES =================

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, roll_number, email, phone, department, designation, specialization, year_of_study, semester, division_batch, role FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, roll_number, phone, department, designation, specialization, year_of_study, semester, division_batch } = req.body;
    await pool.query(
      'UPDATE users SET name=?, roll_number=?, phone=?, department=?, designation=?, specialization=?, year_of_study=?, semester=?, division_batch=? WHERE id=?',
      [name, roll_number || null, phone, department, designation, specialization, year_of_study, semester, division_batch, req.user.id]
    );
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= STUDENT & EXAM ROUTES =================

app.get('/api/student/tests', authenticateToken, async (req, res) => {
  try {
    const [tests] = await pool.query(`
      t.*, 
      (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id AND s.student_id = ?) as is_completed,
      (SELECT s.score FROM submissions s WHERE s.test_id = t.id AND s.student_id = ? LIMIT 1) as score,
      (SELECT s.total_marks FROM submissions s WHERE s.test_id = t.id AND s.student_id = ? LIMIT 1) as total_marks,
      CASE 
        WHEN NOW() < t.start_date THEN 'UPCOMING'
        WHEN NOW() > t.end_date THEN 'EXPIRED'
        ELSE 'ACTIVE'
      END as test_state
      FROM tests t ORDER BY t.created_at DESC
    `, [req.user.id, req.user.id, req.user.id]);
    res.json(tests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tests/:id/questions', authenticateToken, async (req, res) => {
  try {
    const [questions] = await pool.query('SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE test_id = ?', [req.params.id]);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/results', authenticateToken, async (req, res) => {
  try {
    const { test_id, answers, warnings_count } = req.body;
    const student_id = req.user.id;

    const [existing] = await pool.query('SELECT id FROM submissions WHERE test_id = ? AND student_id = ?', [test_id, student_id]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Assessment already submitted.' });
    }

    const [questions] = await pool.query('SELECT id, correct_option FROM questions WHERE test_id = ?', [test_id]);
    let score = 0;
    const total_marks = questions.length;

    questions.forEach(q => {
      const studentAns = answers[q.id] || answers[String(q.id)] || [];
      const studentAnsSorted = Array.isArray(studentAns) ? [...studentAns].sort().join(',') : String(studentAns).trim();
      const correctSorted = String(q.correct_option).trim();

      if (studentAnsSorted === correctSorted) {
        score += 1;
      }
    });

    const percentage = total_marks > 0 ? Math.round((score / total_marks) * 100) : 0;

    const [result] = await pool.query(
      'INSERT INTO submissions (test_id, student_id, score, total_marks, percentage, answers_json, warnings_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [test_id, student_id, score, total_marks, percentage, JSON.stringify(answers), warnings_count || 0]
    );

    res.json({ submissionId: result.insertId, score, total_marks, percentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/results', authenticateToken, async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT s.*, t.title as test_title 
      FROM submissions s 
      JOIN tests t ON s.test_id = t.id 
      WHERE s.student_id = ? 
      ORDER BY s.created_at DESC
    `, [req.user.id]);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/review/:id', authenticateToken, async (req, res) => {
  try {
    const [subs] = await pool.query('SELECT * FROM submissions WHERE id = ? AND student_id = ?', [req.params.id, req.user.id]);
    if (subs.length === 0) return res.status(404).json({ error: 'Submission not found' });
    const sub = subs[0];

    const [questions] = await pool.query('SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions WHERE test_id = ?', [sub.test_id]);
    
    res.json({
      score: sub.score,
      total_marks: sub.total_marks,
      percentage: sub.percentage,
      studentAnswers: JSON.parse(sub.answers_json || '{}'),
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/leaderboard', authenticateToken, async (req, res) => {
  try {
    const testId = req.query.testId;
    let query = '';
    let params = [];

    if (testId && testId !== 'all') {
      query = `
        SELECT u.id, u.name, u.department, 1 as tests_taken, s.score as total_score, s.percentage as avg_percentage
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.test_id = ?
        ORDER BY s.score DESC, s.percentage DESC
      `;
      params = [testId];
    } else {
      query = `
        SELECT u.id, u.name, u.department, COUNT(s.id) as tests_taken, SUM(s.score) as total_score, ROUND(AVG(s.percentage), 2) as avg_percentage
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        GROUP BY u.id
        ORDER BY avg_percentage DESC, total_score DESC
      `;
    }

    const [leaders] = await pool.query(query, params);
    res.json(leaders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= FACULTY ROUTES =================

app.get('/api/faculty/stats', authenticateToken, async (req, res) => {
  try {
    const [[{ totalTests }]] = await pool.query('SELECT COUNT(*) as totalTests FROM tests');
    const [[{ totalStudents }]] = await pool.query('SELECT COUNT(*) as totalStudents FROM users WHERE role = "Student"');
    const [[{ totalSubmissions }]] = await pool.query('SELECT COUNT(*) as totalSubmissions FROM submissions');
    const [[{ avgPass }]] = await pool.query('SELECT ROUND(AVG(percentage), 2) as passRate FROM submissions');

    res.json({
      totalTests,
      totalStudents,
      totalSubmissions,
      passRate: avgPass || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/faculty/students', authenticateToken, async (req, res) => {
  try {
    const [students] = await pool.query(`
      SELECT u.id, u.name, u.roll_number, u.email, u.phone, u.department, u.division_batch, u.semester,
      (SELECT COUNT(*) FROM submissions s WHERE s.student_id = u.id) as tests_taken
      FROM users u 
      WHERE u.role = 'Student'
      ORDER BY u.name ASC
    `);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/faculty/reports', authenticateToken, async (req, res) => {
  try {
    const [reports] = await pool.query(`
      s.id as submission_id, s.score, s.total_marks, s.percentage, s.warnings_count, s.created_at,
      u.name as student_name, u.email as student_email, u.roll_number,
      t.title as test_title
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      JOIN tests t ON s.test_id = t.id
      ORDER BY s.created_at DESC
    `);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/faculty/submissions/:id/reset', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM submissions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Submission reset successfully. Student can retake.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/faculty/tests/:id', authenticateToken, async (req, res) => {
  try {
    const testId = req.params.id;
    await pool.query('DELETE FROM submissions WHERE test_id = ?', [testId]);
    await pool.query('DELETE FROM questions WHERE test_id = ?', [testId]);
    await pool.query('DELETE FROM tests WHERE id = ?', [testId]);
    res.json({ message: 'Assessment and all associated records deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/faculty/generate-ai-questions', authenticateToken, upload.single('materialFile'), async (req, res) => {
  try {
    const { topic, count } = req.body;
    const numQuestions = parseInt(count) || 3;
    let fileContext = '';

    if (req.file) {
      if (req.file.mimetype === 'text/plain') {
        fileContext = req.file.buffer.toString('utf-8');
      } else {
        fileContext = `[Uploaded File Attached: ${req.file.originalname}]`;
      }
    }

    const prompt = `Generate exactly ${numQuestions} multiple-choice questions for an academic test based on the topic: "${topic || 'General Knowledge'}". ${fileContext ? 'Reference material content: ' + fileContext : ''}
    Return ONLY a valid JSON array of objects with no markdown formatting. Each object must have keys: "question_text", "option_a", "option_b", "option_c", "option_d", and "correct_option" (which should be a comma-separated string of correct letters like "A" or "A,C").`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    let textResponse = response.text.trim();
    if (textResponse.startsWith('```json')) {
      textResponse = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (textResponse.startsWith('```')) {
      textResponse = textResponse.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const questions = JSON.parse(textResponse);
    res.json({ questions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate AI questions: ' + err.message });
  }
});

app.post('/api/faculty/tests', authenticateToken, async (req, res) => {
  try {
    const { title, duration_mins, start_date, end_date, questions } = req.body;

    const [testResult] = await pool.query(
      'INSERT INTO tests (title, duration_mins, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?)',
      [title, duration_mins || 15, start_date, end_date, req.user.id]
    );

    const testId = testResult.insertId;

    for (const q of questions) {
      await pool.query(
        'INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [testId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
      );
    }

    res.json({ message: 'Assessment created successfully', testId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`EduTest Backend running on port ${PORT}`);
});