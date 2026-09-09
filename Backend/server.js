const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = 'edutest_super_secret_key_2026';

// MySQL Database Connection Pool (Using Environment Variables for Production)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'online_test_system',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test Database Connection on Startup
async function testDbConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`Successfully connected to MySQL database: ${process.env.DB_NAME || 'online_test_system'}`);
    connection.release();
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
}
testDbConnection();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'edutest.proctor@gmail.com',
    pass: 'abcdefghijklmnop'
  }
});

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Access denied. No token provided.' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Malformed token.' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { 
      name, email, password, role, phone, 
      roll_number, department, year_of_study, semester, division_batch,
      employee_id, designation, specialization 
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Please provide all required fields.' });
    }

    const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const safeRoll = roll_number || 'VU2F2526999';
    const safeDept = department || 'Computer Science & Engineering';
    const safeYear = year_of_study || 'Second Year';
    const safeSem = semester || 'Sem 4';
    const safeBatch = division_batch || 'Div A / B1';
    const safeEmpId = employee_id || 'FAC-999';
    const safeDesig = designation || 'Assistant Professor';
    const safeSpec = specialization || 'Artificial Intelligence';

    await pool.query(`
      INSERT INTO users (
        name, email, password, role, phone, 
        roll_number, department, year_of_study, semester, division_batch,
        employee_id, designation, specialization
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      name, email, hashedPassword, role, phone || '',
      safeRoll, safeDept, safeYear, safeSem, safeBatch,
      safeEmpId, safeDesig, safeSpec
    ]);

    res.status(201).json({ message: 'User registered successfully!' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      token,
      role: user.role,
      name: user.name,
      userId: user.id
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ==================== USER PROFILE ROUTES ====================

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, role, phone, roll_number, department, year_of_study, semester, division_batch FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { name, phone, department, year_of_study, semester, division_batch } = req.body;
    await pool.query(`
      UPDATE users SET name = ?, phone = ?, department = ?, year_of_study = ?, semester = ?, division_batch = ?
      WHERE id = ?
    `, [name, phone, department, year_of_study, semester, division_batch, req.user.id]);
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== STUDENT ROUTES ====================

app.get('/api/student/tests', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const [tests] = await pool.query(`
      SELECT 
        t.*,
        (SELECT COUNT(*) FROM results r WHERE r.test_id = t.id AND r.student_id = ?) AS is_completed,
        (SELECT r.score FROM results r WHERE r.test_id = t.id AND r.student_id = ?) AS score,
        CASE
          WHEN NOW() < t.start_date THEN 'UPCOMING'
          WHEN NOW() > t.end_date THEN 'EXPIRED'
          ELSE 'ACTIVE'
        END AS test_state
      FROM tests t
      ORDER BY t.start_date DESC
    `, [studentId, studentId]);

    res.json(tests);
  } catch (err) {
    console.error('Error loading tests:', err);
    res.status(500).json({ error: 'Failed to load assessments' });
  }
});

app.get('/api/tests/:id/questions', verifyToken, async (req, res) => {
  try {
    const [questions] = await pool.query('SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE test_id = ?', [req.params.id]);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load questions' });
  }
});

app.post('/api/results', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { test_id, answers, warnings_count } = req.body;

    const [existing] = await pool.query('SELECT id FROM results WHERE test_id = ? AND student_id = ?', [test_id, studentId]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'You have already submitted this assessment.' });
    }

    const [questions] = await pool.query('SELECT id, correct_option FROM questions WHERE test_id = ?', [test_id]);
    
    let score = 0;
    const totalMarks = questions.length;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [resultHeader] = await connection.query(`
        INSERT INTO results (test_id, student_id, score, warnings_count) VALUES (?, ?, 0, ?)
      `, [test_id, studentId, warnings_count || 0]);
      
      const resultId = resultHeader.insertId;

      for (const q of questions) {
        const studentChoices = answers[q.id] || [];
        const chosenStr = Array.isArray(studentChoices) ? studentChoices.sort().join(', ') : String(studentChoices);
        
        const correctChoices = q.correct_option.split(',').map(s => s.trim()).sort().join(', ');
        const isCorrect = chosenStr === correctChoices ? 1 : 0;
        if (isCorrect) score++;

        await connection.query(`
          INSERT INTO student_answers (result_id, question_id, chosen_option, is_correct) VALUES (?, ?, ?, ?)
        `, [resultId, q.id, chosenStr, isCorrect]);
      }

      await connection.query('UPDATE results SET score = ? WHERE id = ?', [score, resultId]);
      await connection.commit();
      connection.release();

      if (warnings_count > 0) {
        const [students] = await pool.query('SELECT name, email FROM users WHERE id = ?', [studentId]);
        const [tests] = await pool.query('SELECT title FROM tests WHERE id = ?', [test_id]);
        
        if (students.length > 0 && tests.length > 0) {
          transporter.sendMail({
            from: 'edutest.proctor@gmail.com',
            to: 'faculty@college.edu',
            subject: `[PROCTORING ALERT] Integrity violation flagged for ${students[0].name}`,
            text: `Student: ${students[0].name} (${students[0].email})\nAssessment: ${tests[0].title}\nTab-switch Warnings Flagged: ${warnings_count}/3\nPlease review their activity in the faculty portal.`
          }).catch(mailErr => console.log('Mail warning dispatch skipped:', mailErr.message));
        }
      }

      res.json({ message: 'Exam submitted successfully', score, total_marks: totalMarks });
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }
  } catch (err) {
    console.error('Submission Error:', err);
    res.status(500).json({ error: 'Failed to submit exam responses.' });
  }
});

app.get('/api/student/history', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const [history] = await pool.query(`
      SELECT 
        r.id AS result_id,
        t.title AS test_title,
        r.score,
        t.total_marks,
        ROUND((r.score / t.total_marks) * 100, 2) AS percentage,
        r.warnings_count,
        r.created_at
      FROM results r
      JOIN tests t ON r.test_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `, [studentId]);

    res.json(history);
  } catch (err) {
    console.error('Error fetching student history:', err);
    res.status(500).json({ error: 'Failed to fetch student history' });
  }
});

app.get('/api/student/review/:resultId', verifyToken, async (req, res) => {
  try {
    const [breakdown] = await pool.query(`
      SELECT 
        q.question_text,
        sa.chosen_option,
        q.correct_option,
        sa.is_correct
      FROM student_answers sa
      JOIN questions q ON sa.question_id = q.id
      WHERE sa.result_id = ?
    `, [req.params.resultId]);

    res.json(breakdown);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load review breakdown' });
  }
});

// ==================== FACULTY ROUTES ====================

app.get('/api/faculty/dashboard', verifyToken, async (req, res) => {
  try {
    const [testCount] = await pool.query('SELECT COUNT(*) AS total FROM tests');
    const [studentCount] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE role = "Student"');
    const [avgScore] = await pool.query('SELECT AVG(score) AS avg FROM results');
    const [violations] = await pool.query('SELECT SUM(warnings_count) AS total FROM results');

    res.json({
      total_tests: testCount[0].total,
      total_students: studentCount[0].total,
      average_score: Math.round(avgScore[0].avg || 0),
      total_violations: violations[0].total || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.post('/api/faculty/tests', verifyToken, async (req, res) => {
  try {
    const { title, duration_mins, start_date, end_date, questions } = req.body;
    const totalMarks = questions.length;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [testHeader] = await connection.query(`
        INSERT INTO tests (title, duration_mins, total_marks, start_date, end_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [title, duration_mins, totalMarks, start_date, end_date, req.user.id]);

      const testId = testHeader.insertId;

      for (const q of questions) {
        await connection.query(`
          INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [testId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]);
      }

      await connection.commit();
      connection.release();
      res.status(201).json({ message: 'Assessment created successfully!' });
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }
  } catch (err) {
    console.error('Test Creation Error:', err);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

app.get('/api/faculty/reports', verifyToken, async (req, res) => {
  try {
    const [reports] = await pool.query(`
      SELECT 
        r.id AS result_id,
        u.name AS student_name,
        u.email AS student_email,
        u.roll_number,
        t.title AS test_title,
        r.score,
        t.total_marks,
        ROUND((r.score / t.total_marks) * 100, 2) AS percentage,
        r.warnings_count,
        r.created_at
      FROM results r
      JOIN users u ON r.student_id = u.id
      JOIN tests t ON r.test_id = t.id
      ORDER BY r.created_at DESC
    `);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});