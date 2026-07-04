'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  users: [],      // { id, uid, email, passwordHash, nickname, balance, isAdmin, lastDaily, createdAt }
  markets: [],    // { id, title, category, description, b, qYes, qNo, status, outcome, history, closeAt, createdAt,
                  //   priceSource:'lmsr'|'odds', odds, oddsHistory, oddsProvider, live }
  positions: [],  // { userId, marketId, yes, no, spent }
  txns: [],       // { id, type, from, to, marketId, outcome, amount, meta, createdAt }
  meta: { seq: 1 },
};

let db = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // 兼容旧结构
      for (const k of Object.keys(DEFAULT_DB)) {
        if (db[k] === undefined) db[k] = DEFAULT_DB[k];
      }
    } catch (e) {
      console.error('读取 db.json 失败，将使用空库：', e.message);
      db = structuredClone(DEFAULT_DB);
    }
  } else {
    db = structuredClone(DEFAULT_DB);
    save();
  }
  return db;
}

let saveTimer = null;
function save() {
  ensureDir();
  // 简单防抖：合并短时间内的多次写盘
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 30);
}

function saveNow() {
  ensureDir();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function get() {
  if (!db) load();
  return db;
}

/** 自增 id */
function nextId() {
  const d = get();
  return d.meta.seq++;
}

module.exports = { load, save, saveNow, get, nextId, DB_FILE };