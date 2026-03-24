"""SQLite 資料庫連線與初始化"""
import sqlite3
import logging
from pathlib import Path
from app.config import get_settings

logger = logging.getLogger(__name__)

# SQL schema
SCHEMA_SQL = """
-- 聯絡人表
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT DEFAULT '',
    title TEXT DEFAULT '',
    frequency INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, email)
);

-- 寄件歷史表
CREATE TABLE IF NOT EXISTS send_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT DEFAULT '',
    doc_type TEXT DEFAULT '',
    filename TEXT DEFAULT '',
    ai_confidence REAL DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 使用者 Session 表（對話狀態機）
CREATE TABLE IF NOT EXISTS user_sessions (
    user_id TEXT PRIMARY KEY,
    state TEXT DEFAULT 'idle',
    image_data BLOB,
    image_media_type TEXT DEFAULT 'image/jpeg',
    selected_contact_id INTEGER,
    ai_result TEXT,
    edit_field TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 寄件人設定表
CREATE TABLE IF NOT EXISTS sender_profiles (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    title TEXT DEFAULT '',
    department TEXT DEFAULT '',
    organization TEXT DEFAULT '國立勤益科技大學',
    smtp_host TEXT DEFAULT 'mail.ncut.edu.tw',
    smtp_port INTEGER DEFAULT 587,
    smtp_user TEXT,
    smtp_password_encrypted TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id, frequency DESC);
CREATE INDEX IF NOT EXISTS idx_history_user ON send_history(user_id, sent_at DESC);
"""


def get_db_path() -> str:
    """取得資料庫檔案路徑"""
    settings = get_settings()
    return settings.DATABASE_PATH


def get_connection() -> sqlite3.Connection:
    """取得 SQLite 連線（Row factory 模式）"""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化資料庫 — 建立所有表格"""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        logger.info("資料庫初始化完成: %s", get_db_path())
    finally:
        conn.close()
