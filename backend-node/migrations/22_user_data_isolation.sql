-- 用户级数据隔离 + 三角色权限
-- 1. 给 4 张顶层表加 user_id 列（外键 → users.id）
-- 2. 回填策略：所有 user_id IS NULL 的旧数据默认归 admin（id=1，内置超管）
--    例外：dramas 表里 title='测试' 的归 zhx（id=4，跟实际创建者对齐）
--    回填只动 user_id IS NULL 的行，多次运行幂等。新机器没 zhx 时 UPDATE 是 no-op。
-- 3. zhx 从 super_admin 降级为 admin
-- 4. 索引

ALTER TABLE dramas              ADD COLUMN user_id INTEGER;
ALTER TABLE character_libraries ADD COLUMN user_id INTEGER;
ALTER TABLE scene_libraries     ADD COLUMN user_id INTEGER;
ALTER TABLE prop_libraries      ADD COLUMN user_id INTEGER;

-- 先把所有未归属的 dramas 归 admin（兜底）
UPDATE dramas SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
  WHERE user_id IS NULL;

-- 再把 title='测试' 的那条改归 zhx（如果 zhx 用户存在）
UPDATE dramas SET user_id = (SELECT id FROM users WHERE username = 'zhx' LIMIT 1)
  WHERE title = '测试'
    AND user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
    AND EXISTS (SELECT 1 FROM users WHERE username = 'zhx');

-- 3 个素材库现有数据全归 admin
UPDATE character_libraries SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
  WHERE user_id IS NULL;
UPDATE scene_libraries SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
  WHERE user_id IS NULL;
UPDATE prop_libraries SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
  WHERE user_id IS NULL;

-- zhx 降级
UPDATE users SET role = 'admin' WHERE username = 'zhx' AND role = 'super_admin';

CREATE INDEX IF NOT EXISTS idx_dramas_user_id              ON dramas(user_id);
CREATE INDEX IF NOT EXISTS idx_character_libraries_user_id ON character_libraries(user_id);
CREATE INDEX IF NOT EXISTS idx_scene_libraries_user_id     ON scene_libraries(user_id);
CREATE INDEX IF NOT EXISTS idx_prop_libraries_user_id      ON prop_libraries(user_id);
