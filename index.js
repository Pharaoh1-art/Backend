const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "my_super_secret_key";
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        birth_date DATE,
        password TEXT NOT NULL,
        coins INT DEFAULT 100,
        device_type VARCHAR(100),
        ip_address VARCHAR(50),
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    dbInitialized = true;
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

// 1. إنشاء حساب جديد
app.post('/register', async (req, res) => {
  await initDB();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const { username, email, birth_date, password, device_type } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "برجاء ملء جميع الحقول المطلوبة!" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, birth_date, password, device_type, ip_address, last_login) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING id, username, email',
      [username, email, birth_date, hashedPassword, device_type, ip]
    );
    res.json({ message: "تم إنشاء الحساب بنجاح!", user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: "اسم المستخدم أو الإيميل مستخدم بالفعل، جرب اسماً آخر." });
    }
    res.status(500).json({ error: "حدث خطأ في السيرفر أثناء التسجيل." });
  }
});

// 2. تسجيل الدخول
app.post('/login', async (req, res) => {
  await initDB();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const { username, password, device_type } = req.body;
  
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "الاسم أو كلمة السر غير صحيحة!" });
    }

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "الاسم أو كلمة السر غير صحيحة!" });
    }

    // تحديث بيانات الدخول (الآي بي، الجهاز، الوقت)
    await pool.query('UPDATE users SET ip_address = $1, device_type = $2, last_login = CURRENT_TIMESTAMP WHERE id = $3', [ip, device_type, user.id]);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    res.json({ token: token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ في السيرفر أثناء تسجيل الدخول." });
  }
});

module.exports = app;
