const serverless = require('serverless-http');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const { Pool } = (() => {
  try { return require('pg'); } catch (e) { return {}; }
})();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const TOKEN_EXP = '7d';

const app = express();
app.use(bodyParser.json());

// Database abstraction: Postgres if DATABASE_URL present, else SQLite
let dbType = 'sqlite';
let sqliteDb = null;
let pgPool = null;

async function initDb() {
  if (process.env.DATABASE_URL) {
    dbType = 'pg';
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false });
    // create tables if not exist
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE,
        teacher_id INTEGER REFERENCES teachers(id),
        created_at BIGINT
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        qr_id INTEGER REFERENCES qr_codes(id),
        name TEXT,
        grade TEXT,
        section TEXT,
        created_at BIGINT
      );
    `);
  } else {
    dbType = 'sqlite';
    const DB_PATH = process.env.DB_PATH || './data.db';
    sqliteDb = new sqlite3.Database(DB_PATH);
    sqliteDb.serialize(() => {
      sqliteDb.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT
      )`);

      sqliteDb.run(`CREATE TABLE IF NOT EXISTS qr_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        teacher_id INTEGER,
        created_at INTEGER
      )`);

      sqliteDb.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qr_id INTEGER,
        name TEXT,
        grade TEXT,
        section TEXT,
        created_at INTEGER
      )`);
    });
  }
}

function generateCode() {
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

// API routes
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    if (dbType === 'pg') {
      const result = await pgPool.query(`INSERT INTO teachers (name, email, password) VALUES ($1, $2, $3) RETURNING id`, [name || '', email, hash]);
      const teacher = { id: result.rows[0].id, email };
      const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
      res.json({ token, teacher });
    } else {
      sqliteDb.run(`INSERT INTO teachers (name, email, password) VALUES (?, ?, ?)`, [name || '', email, hash], function (err) {
        if (err) return res.status(400).json({ error: 'Could not create account (email may already exist)' });
        const teacher = { id: this.lastID, email };
        const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
        res.json({ token, teacher });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    if (dbType === 'pg') {
      const result = await pgPool.query(`SELECT id, email, password, name FROM teachers WHERE email = $1`, [email]);
      const row = result.rows[0];
      if (!row) return res.status(400).json({ error: 'invalid credentials' });
      const ok = await bcrypt.compare(password, row.password);
      if (!ok) return res.status(400).json({ error: 'invalid credentials' });
      const teacher = { id: row.id, email: row.email, name: row.name };
      const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
      res.json({ token, teacher });
    } else {
      sqliteDb.get(`SELECT id, email, password, name FROM teachers WHERE email = ?`, [email], async (err, row) => {
        if (err) return res.status(500).json({ error: 'server error' });
        if (!row) return res.status(400).json({ error: 'invalid credentials' });
        const ok = await bcrypt.compare(password, row.password);
        if (!ok) return res.status(400).json({ error: 'invalid credentials' });
        const teacher = { id: row.id, email: row.email, name: row.name };
        const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: TOKEN_EXP });
        res.json({ token, teacher });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/qr', authMiddleware, async (req, res) => {
  const teacherId = req.user.id;
  const code = generateCode();
  const createdAt = Date.now();
  try {
    if (dbType === 'pg') {
      const result = await pgPool.query(`INSERT INTO qr_codes (code, teacher_id, created_at) VALUES ($1, $2, $3) RETURNING id`, [code, teacherId, createdAt]);
      res.json({ id: result.rows[0].id, code, created_at: createdAt });
    } else {
      sqliteDb.run(`INSERT INTO qr_codes (code, teacher_id, created_at) VALUES (?, ?, ?)`, [code, teacherId, createdAt], function (err) {
        if (err) return res.status(500).json({ error: 'could not create qr' });
        res.json({ id: this.lastID, code, created_at: createdAt });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/qr', authMiddleware, async (req, res) => {
  const teacherId = req.user.id;
  try {
    if (dbType === 'pg') {
      const result = await pgPool.query(`SELECT id, code, created_at FROM qr_codes WHERE teacher_id = $1 ORDER BY created_at DESC`, [teacherId]);
      res.json({ qrs: result.rows });
    } else {
      sqliteDb.all(`SELECT id, code, created_at FROM qr_codes WHERE teacher_id = ? ORDER BY created_at DESC`, [teacherId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'server error' });
        res.json({ qrs: rows });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/qr/:id/students', authMiddleware, async (req, res) => {
  const teacherId = req.user.id;
  const qrId = req.params.id;
  try {
    if (dbType === 'pg') {
      const check = await pgPool.query(`SELECT id FROM qr_codes WHERE id = $1 AND teacher_id = $2`, [qrId, teacherId]);
      if (check.rowCount === 0) return res.status(403).json({ error: 'not allowed' });
      const students = await pgPool.query(`SELECT id, name, grade, section, created_at FROM students WHERE qr_id = $1 ORDER BY created_at DESC`, [qrId]);
      res.json({ students: students.rows });
    } else {
      sqliteDb.get(`SELECT id FROM qr_codes WHERE id = ? AND teacher_id = ?`, [qrId, teacherId], (err, row) => {
        if (err) return res.status(500).json({ error: 'server error' });
        if (!row) return res.status(403).json({ error: 'not allowed' });
        sqliteDb.all(`SELECT id, name, grade, section, created_at FROM students WHERE qr_id = ? ORDER BY created_at DESC`, [qrId], (err2, rows) => {
          if (err2) return res.status(500).json({ error: 'server error' });
          res.json({ students: rows });
        });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/attend/:code', async (req, res) => {
  const code = req.params.code;
  const { name, grade, section } = req.body;
  if (!name || !grade || !section) return res.status(400).json({ error: 'name, grade and section required' });
  try {
    if (dbType === 'pg') {
      const qr = await pgPool.query(`SELECT id FROM qr_codes WHERE code = $1`, [code]);
      if (qr.rowCount === 0) return res.status(404).json({ error: 'qr not found or expired' });
      const qrId = qr.rows[0].id;
      const createdAt = Date.now();
      const result = await pgPool.query(`INSERT INTO students (qr_id, name, grade, section, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [qrId, name, grade, section, createdAt]);
      res.json({ id: result.rows[0].id, qr_id: qrId, name, grade, section, created_at: createdAt });
    } else {
      sqliteDb.get(`SELECT id FROM qr_codes WHERE code = ?`, [code], (err, row) => {
        if (err) return res.status(500).json({ error: 'server error' });
        if (!row) return res.status(404).json({ error: 'qr not found or expired' });
        const qrId = row.id;
        const createdAt = Date.now();
        sqliteDb.run(`INSERT INTO students (qr_id, name, grade, section, created_at) VALUES (?, ?, ?, ?, ?)`, [qrId, name, grade, section, createdAt], function (err2) {
          if (err2) return res.status(500).json({ error: 'could not save attendance' });
          res.json({ id: this.lastID, qr_id: qrId, name, grade, section, created_at: createdAt });
        });
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

// Expose the app for local testing via /api - Vercel will use this handler
initDb().catch(console.error);

module.exports.handler = serverless(app);
