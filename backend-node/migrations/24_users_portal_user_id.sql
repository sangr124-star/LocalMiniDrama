-- 用户表加 portal_user_id，作为 jz portal 中心用户的本地投影
-- SQLite 不支持 ADD COLUMN UNIQUE，所以用 partial unique index 实现"非 NULL 时唯一"
ALTER TABLE users ADD COLUMN portal_user_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_portal_user_id ON users(portal_user_id) WHERE portal_user_id IS NOT NULL;
