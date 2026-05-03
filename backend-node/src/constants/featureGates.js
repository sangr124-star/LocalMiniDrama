// 针对个别账号的功能开洞清单（不是角色级别的权限，而是"特例"）
// 当前规则：clue 用户名出现在 PROMPT_HIDDEN_USERS 里 → 看不到「高级设置（提示词）」tab + 调相关 API 返 403
const PROMPT_HIDDEN_USERS = ['zhx'];

function normalizeUsername(u) {
  if (!u) return '';
  return String(u).trim().toLowerCase();
}

function isPromptHidden(user) {
  if (!user) return false;
  const name = normalizeUsername(user.username);
  if (!name) return false;
  return PROMPT_HIDDEN_USERS.map(normalizeUsername).includes(name);
}

module.exports = { PROMPT_HIDDEN_USERS, isPromptHidden };
