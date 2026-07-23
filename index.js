const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "my_super_secret_key";

// متغير للتأكد من إنشاء الجدول مرة واحدة فقط
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        coins INT DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    dbInitialized = true;
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

// 1. تسجيل حساب جديد (Register)
app.post('/register', async (req, res) => {
  await initDB(); // التأكد من وجود الجدول
  
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "اسم المستخدم وكلمة السر مطلوبان" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, coins) VALUES ($1, $2, $3) RETURNING id, username, coins',
      [username, hashedPassword, 100]
    );
    res.json({ message: "تم إنشاء الحساب بنجاح", user: result.rows[0] });
  } catch (err) {
    console.error("Register Error:", err);
    if (err.code === '23505') {
      return res.status(400).json({ error: "اسم المستخدم مستخدم بالفعل" });
    }
    res.status(500).json({ error: "حدث خطأ في السيرفر", details: err.message });
  }
});

// 2. تسجيل الدخول (Login)
app.post('/login', async (req, res) => {
  await initDB();
  
  const { username, password } = req.body;
  
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    res.json({
      token: token,
      user: { id: user.id, username: user.username, coins: user.coins }
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "حدث خطأ في السيرفر", details: err.message });
  }
});

// 3. إضافة عملات للاعب (Add Coins)
app.post('/add-coins', async (req, res) => {
  const { userId, coinsToAdd } = req.body;

  try {
    const result = await pool.query(
      'UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING id, username, coins',
      [coinsToAdd, userId]
    );
    res.json({ message: "تم تحديث الرصيد بنجاح", user: result.rows[0] });
  } catch (err) {
    console.error("Add Coins Error:", err);
    res.status(500).json({ error: "حدث خطأ في تحديث الرصيد", details: err.message });
  }
});

// تصدير التطبيق لبيئة Vercel (مهم جداً)
module.exports = app;

// تشغيل محلي للتجربة فقط
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
