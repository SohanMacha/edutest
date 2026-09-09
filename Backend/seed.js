const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seedDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'online_test_system'
  });

  console.log('Connected to MySQL. Preparing demo dataset...');

  try {
    // 1. Clean existing records in proper foreign-key order
    await connection.query('DELETE FROM answers');
    await connection.query('DELETE FROM results');
    await connection.query('DELETE FROM questions');
    await connection.query('DELETE FROM tests');
    await connection.query('DELETE FROM users');

    console.log('Cleared previous database entries.');

    // 2. Insert Faculty & Students
    const hashedFacultyPass = await bcrypt.hash('faculty123', 10);
    const hashedStudentPass = await bcrypt.hash('student123', 10);

    // Primary Faculty Account
    const [facultyResult] = await connection.query(`
      INSERT INTO users (name, email, password, role, phone, employee_id, department, designation, specialization)
      VALUES (?, ?, ?, 'faculty', ?, ?, ?, ?, ?)
    `, [
      'Prof. Alan Turing',
      'faculty@college.edu',
      hashedFacultyPass,
      '+91 9876543210',
      'FAC-1001',
      'Computer Science & Engineering',
      'Professor & HOD',
      'Algorithms & Machine Learning'
    ]);

    const facultyId = facultyResult.insertId;

    // Insert 4 Enrolled Students
    const studentsData = [
      ['Aarav Sharma', 'aarav@college.edu', '9820112233', 'VU2F2526001', 'CSE (AI & ML)', 'Second Year', 'Sem 4', 'Div A / B1'],
      ['Pooja Patel', 'pooja@college.edu', '9820223344', 'VU2F2526002', 'CSE (AI & ML)', 'Second Year', 'Sem 4', 'Div A / B1'],
      ['Rohan Verma', 'rohan@college.edu', '9820334455', 'VU2F2526003', 'Information Technology', 'Third Year', 'Sem 6', 'Div B / B2'],
      ['Ananya Iyer', 'ananya@college.edu', '9820445566', 'VU2F2526004', 'Computer Engineering', 'Final Year', 'Sem 8', 'Div A / B3']
    ];

    const studentIds = [];
    for (const st of studentsData) {
      const [stRes] = await connection.query(`
        INSERT INTO users (name, email, password, role, phone, roll_number, department, year_of_study, semester, division_batch)
        VALUES (?, ?, ?, 'student', ?, ?, ?, ?, ?, ?)
      `, [st[0], st[1], hashedStudentPass, st[2], st[3], st[4], st[5], st[6], st[7]]);
      studentIds.push(stRes.insertId);
    }

    console.log('Inserted default Faculty and 4 Student profiles.');

    // 3. Create Sample Assessments
    const now = new Date();
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Test 1: Data Structures & Algorithms (Active)
    const [test1] = await connection.query(`
      INSERT INTO tests (title, duration_mins, start_date, end_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `, ['Data Structures & Graph Theory', 15, now, futureDate, facultyId]);

    const qList1 = [
      {
        text: 'Which of the following data structures guarantee O(1) average lookup time?',
        a: 'Hash Table', b: 'Array (index access)', c: 'Linked List', d: 'Binary Search Tree',
        correct: 'A,B'
      },
      {
        text: 'Which algorithms are used to find the shortest path in a weighted graph?',
        a: 'Dijkstra Algorithm', b: 'Bellman-Ford Algorithm', c: 'Bubble Sort', d: 'Floyd-Warshall Algorithm',
        correct: 'A,B,D'
      }
    ];

    for (const q of qList1) {
      await connection.query(`
        INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [test1.insertId, q.text, q.a, q.b, q.c, q.d, q.correct]);
    }

    // Test 2: Database Management Systems (Active)
    const [test2] = await connection.query(`
      INSERT INTO tests (title, duration_mins, start_date, end_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `, ['Database Management Systems Quiz', 10, now, futureDate, facultyId]);

    const qList2 = [
      {
        text: 'Which of the following are ACID properties in DBMS?',
        a: 'Atomicity', b: 'Consistency', c: 'Isolation', d: 'Durability',
        correct: 'A,B,C,D'
      },
      {
        text: 'Which commands belong to DDL (Data Definition Language)?',
        a: 'CREATE', b: 'ALTER', c: 'SELECT', d: 'DROP',
        correct: 'A,B,D'
      }
    ];

    for (const q of qList2) {
      await connection.query(`
        INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [test2.insertId, q.text, q.a, q.b, q.c, q.d, q.correct]);
    }

    // 4. Create Realistic Submissions & Simulated Cheat Warnings
    // Aarav: Clean 100% submission
    const [res1] = await connection.query(`
      INSERT INTO results (user_id, test_id, score, total_marks, warnings_count)
      VALUES (?, ?, 2, 2, 0)
    `, [studentIds[0], test1.insertId]);

    // Pooja: Partial score + 1 cheat flag
    const [res2] = await connection.query(`
      INSERT INTO results (user_id, test_id, score, total_marks, warnings_count)
      VALUES (?, ?, 1, 2, 1)
    `, [studentIds[1], test1.insertId]);

    // Rohan: High violation flagged submission (3 warnings)
    const [res3] = await connection.query(`
      INSERT INTO results (user_id, test_id, score, total_marks, warnings_count)
      VALUES (?, ?, 1, 2, 3)
    `, [studentIds[2], test1.insertId]);

    console.log('\n=============================================');
    console.log(' Database Seeded Successfully!');
    console.log('=============================================');
    console.log('Faculty Login : faculty@college.edu | faculty123');
    console.log('Student Login : aarav@college.edu   | student123');
    console.log('Student Login : pooja@college.edu   | student123');
    console.log('=============================================\n');

  } catch (err) {
    console.error('Seeding error:', err.message);
  } finally {
    await connection.end();
  }
}

seedDatabase();