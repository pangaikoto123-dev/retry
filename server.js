const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || './data.db';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const TOKEN_EXP = '7d';

const db = new sqlite3.Database(DB_PATH);

// Initialize DB
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS qr_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    teacher_id INTEGER,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id INTEGER,
    name TEXT,
    grade TEXT,
    section TEXT,
    created_at INTEGER
  )`);
});

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateCode() {
  // 8-char base36 code
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing authorization' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid authorization' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO teachers (name, email, password) VALUES (?, ?, ?)`, [name || '', email, hash], function (err) {
      if (err) {
        return res.status(400).json({ error: 'Could not create account (email may already exist)' });
      }
      const teacher = { id: this.lastID, email };
      const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
      res.json({ token, teacher });
    });
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  db.get(`SELECT id, email, password, name FROM teachers WHERE email = ?`, [email], async (err, row) => {
    if (err) return res.status(500).json({ error: 'server error' });
    if (!row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });
    const teacher = { id: row.id, email: row.email, name: row.name };
    const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
    res.json({ token, teacher });
  });
});

app.post('/api/qr', authMiddleware, (req, res) => {
  const teacherId = req.user.id;
  const code = generateCode();
  const createdAt = Date.now();
  db.run(`INSERT INTO qr_codes (code, teacher_id, created_at) VALUES (?, ?, ?)`, [code, teacherId, createdAt], function (err) {
    if (err) return res.status(500).json({ error: 'could not create qr' });
    res.json({ id: this.lastID, code, created_at: createdAt });
  });
});

app.get('/api/qr', authMiddleware, (req, res) => {
  const teacherId = req.user.id;
  db.all(`SELECT id, code, created_at FROM qr_codes WHERE teacher_id = ? ORDER BY created_at DESC`, [teacherId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server error' });
    res.json({ qrs: rows });
  });
});

app.get('/api/qr/:id/students', authMiddleware, (req, res) => {
  const teacherId = req.user.id;
  const qrId = req.params.id;
  // ensure this qr belongs to teacher
  db.get(`SELECT id FROM qr_codes WHERE id = ? AND teacher_id = ?`, [qrId, teacherId], (err, row) => {
    if (err) return res.status(500).json({ error: 'server error' });
    if (!row) return res.status(403).json({ error: 'not allowed' });
    db.all(`SELECT id, name, grade, section, created_at FROM students WHERE qr_id = ? ORDER BY created_at DESC`, [qrId], (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'server error' });
      res.json({ students: rows });
    });
  });
});

app.post('/api/attend/:code', (req, res) => {
  const code = req.params.code;
  const { name, grade, section } = req.body;
  if (!name || !grade || !section) return res.status(400).json({ error: 'name, grade and section required' });
  db.get(`SELECT id FROM qr_codes WHERE code = ?`, [code], (err, row) => {
    if (err) return res.status(500).json({ error: 'server error' });
    if (!row) return res.status(404).json({ error: 'qr not found or expired' });
    const qrId = row.id;
    const createdAt = Date.now();
    db.run(`INSERT INTO students (qr_id, name, grade, section, created_at) VALUES (?, ?, ?, ?, ?)`, [qrId, name, grade, section, createdAt], function (err2) {
      if (err2) return res.status(500).json({ error: 'could not save attendance' });
      res.json({ id: this.lastID, qr_id: qrId, name, grade, section, created_at: createdAt });
    });
  });
});

// route for student-facing QR link - serve student.html
app.get('/r/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
