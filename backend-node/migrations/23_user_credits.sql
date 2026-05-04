-- 23_user_credits.sql：用户积分体系
-- 1) users 加 4 列：余额 + 累计充值 + 累计消耗 + created_by（admin 给"自己创建的 user"充值的依据）
-- 2) credit_ledger 流水表：所有充值/消费/扣减/退款记录
-- 3) credit_pricing 计价表：service_type × model × unit → price
-- 4) 计价种子数据 + 全局设置

ALTER TABLE users ADD COLUMN credit_balance         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_recharged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_consumed  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN created_by             INTEGER;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL,
  scope           TEXT,
  service_type    TEXT,
  model           TEXT,
  estimated       INTEGER NOT NULL DEFAULT 0,
  real_cost       INTEGER NOT NULL DEFAULT 0,
  price_snapshot  TEXT,
  drama_id        INTEGER,
  episode_id      INTEGER,
  scene_key       TEXT,
  operator_id     INTEGER,
  note            TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user   ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_status ON credit_ledger(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_scope  ON credit_ledger(scope, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_pricing (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_type    TEXT NOT NULL,
  model           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  price           INTEGER NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(service_type, model, unit)
);

-- 计价种子数据（保守估算；super_admin 后续可在 UI 调整）
INSERT OR IGNORE INTO credit_pricing (service_type, model, unit, price, note, created_at, updated_at) VALUES
  ('text','*','per_1k_input',  10, '兜底单价（输入）','2026-05-04','2026-05-04'),
  ('text','*','per_1k_output', 30, '兜底单价（输出）','2026-05-04','2026-05-04'),
  ('text','claude-sonnet-4','per_1k_input',  30, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-sonnet-4','per_1k_output',150, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-opus-4','per_1k_input',  150, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-opus-4','per_1k_output', 750, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o','per_1k_input',  25, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o','per_1k_output',100, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o-mini','per_1k_input',  3, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o-mini','per_1k_output',12, NULL,'2026-05-04','2026-05-04'),
  ('text','qwen-turbo','per_1k_input',  3, NULL,'2026-05-04','2026-05-04'),
  ('text','qwen-turbo','per_1k_output',12, NULL,'2026-05-04','2026-05-04'),
  ('image','*','per_image', 200, '兜底单价','2026-05-04','2026-05-04'),
  ('image','seedream-4','per_image', 200, NULL,'2026-05-04','2026-05-04'),
  ('image','seedream-3','per_image', 150, NULL,'2026-05-04','2026-05-04'),
  ('image','jimeng-3','per_image', 150, NULL,'2026-05-04','2026-05-04'),
  ('image','gemini-2.5-flash-image','per_image', 200, NULL,'2026-05-04','2026-05-04'),
  ('image','grok-image','per_image', 200, NULL,'2026-05-04','2026-05-04'),
  ('video','*','per_second', 200, '兜底单价','2026-05-04','2026-05-04'),
  ('video','seedance-1080p','per_second', 200, NULL,'2026-05-04','2026-05-04'),
  ('video','seedance-720p','per_second', 100, NULL,'2026-05-04','2026-05-04'),
  ('video','jimeng-video-3','per_second', 200, NULL,'2026-05-04','2026-05-04'),
  ('video','grok-video-3','per_second', 250, NULL,'2026-05-04','2026-05-04'),
  ('video','grok-video-3-10s','per_second', 250, NULL,'2026-05-04','2026-05-04'),
  ('tts','*','per_1k_chars', 50, '兜底单价','2026-05-04','2026-05-04'),
  ('tts','volcengine-doubao','per_1k_chars', 50, NULL,'2026-05-04','2026-05-04'),
  ('tts','minimax','per_1k_chars', 80, NULL,'2026-05-04','2026-05-04'),
  ('tts','openai-tts','per_1k_chars', 100, NULL,'2026-05-04','2026-05-04');

-- 全局设置
INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES
  ('credits.signup_bonus','5000','2026-05-04'),
  ('credits.low_balance_threshold','1000','2026-05-04');
