const { Pool } = require('pg');

// ربط قاعدة البيانات باستخدام الرابط المعرف في متغيرات البيئة (DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

module.exports = pool;
