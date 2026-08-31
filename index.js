const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: '*/*' }));
app.use(cors());

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

    // فك تشفير النص إذا كان القادم Base64 لطباعته في Vercel Logs
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
// 2. مسار تهيئة الـ SDK الشامل (مطابق تماماً لـ QNApiFactory$2)
// ==========================================
app.all(['/sdk/init', '/api/sdk/init', '/user/init', '/user/checkVersion'], (req, res) => {
  res.status(200).json({
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
  });
});

// مسار طلب الدخول من الـ SDK
app.all(['/user/userLogin', '/api/sdk/userLogin', '/user/login'], (req, res) => {
  res.status(200).json({
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
  });
});

// نبض الحياة
app.all(['/user/heartbeat', '/api/sdk/heartbeat'], (req, res) => {
  res.status(200).json({ code: 200, status: 1, msg: "ok" });
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
// 5. واجهة تسجيل الدخول المدمجة
// ==========================================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>تسجيل الدخول</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: rgba(0,0,0,0.6); margin: 0; color: white; }
        .login-box { background: #1e1e1e; padding: 25px; border-radius: 12px; width: 85%; max-width: 320px; text-align: center; box-shadow: 0 8px 20px rgba(0,0,0,0.8); border: 2px solid #333; }
        h2 { margin-top: 0; color: #ff9800; font-size: 24px; }
        input { width: 90%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #555; background: #2a2a2a; color: white; font-size: 16px; outline: none; box-sizing: border-box; }
        input:focus { border-color: #ff9800; }
        button { width: 100%; padding: 12px; background: #ff9800; color: #000; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 15px; box-sizing: border-box; transition: 0.3s;}
        button:hover { background: #e68a00; }
        .toggle { margin-top: 20px; font-size: 14px; color: #bbb; cursor: pointer; text-decoration: underline; }
        #msg { margin-top: 15px; font-weight: bold; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="login-box">
        <h2 id="title">تسجيل الدخول</h2>
        <input type="text" id="username" placeholder="اسم المستخدم (إنجليزي)">
        <input type="password" id="password" placeholder="كلمة السر">
        <input type="email" id="email" placeholder="البريد الإلكتروني" style="display: none;">
        
        <button onclick="submitForm()" id="submitBtn">دخول</button>
        <div class="toggle" onclick="toggleMode()" id="toggleBtn">ليس لديك حساب؟ إنشاء حساب جديد</div>
        <div id="msg"></div>
      </div>

      <script>
        let isLogin = true;
        
        function toggleMode() {
          isLogin = !isLogin;
          document.getElementById('title').innerText = isLogin ? 'تسجيل الدخول' : 'إنشاء حساب جديد';
          document.getElementById('submitBtn').innerText = isLogin ? 'دخول' : 'تسجيل';
          document.getElementById('toggleBtn').innerText = isLogin ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد';
          document.getElementById('email').style.display = isLogin ? 'none' : 'inline-block';
          document.getElementById('msg').innerText = '';
        }

        async function submitForm() {
          const u = document.getElementById('username').value;
          const p = document.getElementById('password').value;
          const e = document.getElementById('email').value;
          const btn = document.getElementById('submitBtn');
          const msgBox = document.getElementById('msg');
          
          if(!u || !p || (!isLogin && !e)) {
            msgBox.style.color = '#ff4d4d';
            msgBox.innerText = 'برجاء ملء جميع الحقول المطلوبة';
            return;
          }
          
          btn.disabled = true;
          btn.innerText = 'جاري التحميل...';
          
          const endpoint = isLogin ? '/login' : '/register';
          const body = isLogin ? 
            { username: u, password: p, device_type: "android" } : 
            { username: u, password: p, email: e, device_type: "android", birth_date: "2000-01-01" };
          
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            const data = await res.json();
            
            if(res.ok) {
              msgBox.style.color = '#00e676';
              if(isLogin) {
                msgBox.innerText = 'تم الدخول بنجاح! جاري التوجيه...';
                setTimeout(() => {
                   document.body.innerHTML = "<h2 style='text-align:center; color:#00e676; margin-top:50px;'>تم تسجيل الدخول، يمكنك العودة للعبة!</h2>";
                }, 1500);
              } else {
                msgBox.innerText = 'تم إنشاء الحساب بنجاح! قم بتسجيل الدخول الآن.';
                setTimeout(toggleMode, 2000);
              }
            } else {
              msgBox.style.color = '#ff4d4d';
              msgBox.innerText = data.error || 'حدث خطأ';
            }
          } catch(err) {
            msgBox.style.color = '#ff4d4d';
            msgBox.innerText = 'خطأ في الاتصال بالسيرفر';
          }
          btn.disabled = false;
          btn.innerText = isLogin ? 'دخول' : 'تسجيل';
        }
      </script>
    </body>
    </html>
  `);
});

module.exports = app;
