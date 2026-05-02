-- 用户体系（精简版，仅区分 super_admin 和 user）
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL DEFAULT '',
  nickname   TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
