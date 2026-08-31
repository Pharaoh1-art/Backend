const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const pool = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: '*/*' }));
app.use(cors());

// تقديم الملفات الستاتيكية من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || "my_super_secret_key";
let dbInitialized = false;

// ==========================================
// 1. طبقة الالتقاط العامة + فك تشفير Payload
// ==========================================
app.use((req, res, next) => {
  console.log(`[LOG] ${new Date().toISOString()} | ${req.method} -> ${req.url}`);
  
  if (req.body) {
    let bodyStr = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    console.log("[PAYLOAD RAW]:", bodyStr);

    try {
      if (typeof bodyStr === 'string' && bodyStr.startsWith('ey')) {
        const decoded = Buffer.from(bodyStr, 'base64').toString('utf-8');
        console.log("[DECODED PAYLOAD]:", decoded);
      }
    } catch (e) {
      // تجاهل إذا لم يكن Base64
    }
  }
  next();
});

// تهيئة قاعدة البيانات
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

// ==========================================
// دالة مساعدة لتشفير الرد بـ Base64
// ==========================================
function sendBase64Response(res, dataObject) {
  const jsonString = JSON.stringify(dataObject);
  const base64String = Buffer.from(jsonString, 'utf-8').toString('base64');
  res.setHeader('Content-Type', 'text/plain');
  return res.status(200).send(base64String);
}

// ==========================================
// 2. كائن الرد الموحد للـ SDK
// ==========================================
const initSdkData = {
  code: 200,
  msg: "success",
  message: "success",
  data: {
    deviceKey: "qn_device_key_888888",
    appVersion: "1.1.20",
    appUrl: "",
    registerStatus: 1,
    updateBaseUrl: "",
    updateBaseVersion: "1.1.20",
    appId: "656606",
    server_time: Math.floor(Date.now() / 1000),
    login_url: "https://backend-ecru-delta-39.vercel.app/",
    h5_url: "https://backend-ecru-delta-39.vercel.app/",
    url: "https://backend-ecru-delta-39.vercel.app/"
  }
};

// التعامل مع جميع مسارات الـ Init بما فيها المسار الرئيسي /
app.all(['/', '/sdk/init', '/api/sdk/init', '/user/init', '/user/checkVersion'], (req, res) => {
  sendBase64Response(res, initSdkData);
});

// مسار طلب الدخول من الـ SDK
app.all(['/user/userLogin', '/api/sdk/userLogin', '/user/login'], (req, res) => {
  const responseData = {
    code: 200,
    status: 1,
    msg: "success",
    data: {
      uid: "2187278390272",
      token: "eyJhbGciOiJIUzI1NiJ9.test_token_verified",
      is_new: 0,
      accessKey: "69b9065891d246dc9414",
      login_url: "https://backend-ecru-delta-39.vercel.app/"
    }
  };

  sendBase64Response(res, responseData);
});

// نبض الحياة
app.all(['/user/heartbeat', '/api/sdk/heartbeat'], (req, res) => {
  sendBase64Response(res, { code: 200, status: 1, msg: "ok" });
});

// ==========================================
// 3. مسارات فحص وتحديثات اللعبة
// ==========================================
app.get('/RELEASE/1_11_2/android/patch/:filename', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send("{}");
});

app.get('/RELEASE/1_11_2/android/split/:filename', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send('{"depends":{},"assets":{}}');
});

// ==========================================
// 4. مسارات الحسابات والـ API
// ==========================================
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

    await pool.query('UPDATE users SET ip_address = $1, device_type = $2, last_login = CURRENT_TIMESTAMP WHERE id = $3', [ip, device_type, user.id]);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    res.json({ token: token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ في السيرفر أثناء تسجيل الدخول." });
  }
});

// ==========================================
// 5. استدعاء ملف صفحة تسجيل الدخول المنفصل
// ==========================================
app.get('/login-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

module.exports = app;
