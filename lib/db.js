'use strict';

const mysql = require('mysql2/promise');

let pool;

async function init() {
  pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset:  'utf8mb4',
    waitForConnections: true,
    connectionLimit:    10,
  });

  // 測試連線
  const conn = await pool.getConnection();
  console.log('✅ 資料庫連線成功');
  conn.release();
}

async function query(sql, params = []) {
  if (!pool) throw new Error('DB pool not initialized');
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { init, query };
