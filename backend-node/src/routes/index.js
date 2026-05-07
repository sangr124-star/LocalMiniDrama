const express = require('express');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptOverridesRoutes = require('./promptOverrides');
const sceneModelMapRoutes = require('./sceneModelMap');
const authRoutes = require('./auth');
const adminRoutes = require('./admin');
const creditRoutes = require('./credits');
const { buildAuthMiddleware } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { buildOwnershipMiddleware } = require('../middleware/ownership');
const { buildSsoHandler } = require('../middleware/portalSso');

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const auth = authRoutes(db, log);
  const admin = adminRoutes(db, log);
  const { authenticate } = buildAuthMiddleware(db);
  const requireOwnership = buildOwnershipMiddleware(db);

  // ---------- 认证（无需登录的端点） ----------
  r.post('/auth/login', auth.login);
  // jz portal SSO 入口（验签后建/找本地 user，发本地 token，302 回前端）
  r.get('/auth/sso', buildSsoHandler(db));

  // ---------- 全局认证：以下所有路由都需要 token ----------
  r.use(authenticate);

  // ---------- 当前用户 / 修改密码 ----------
  r.get('/auth/me', auth.me);
  r.post('/auth/change-password', auth.changePassword);

  // ---------- 用户管理（仅 super_admin 可访问） ----------
  r.get('/admin/users', requireSuperAdmin, admin.listUsers);
  r.post('/admin/users', requireSuperAdmin, admin.createUser);
  r.put('/admin/users/:id', requireSuperAdmin, admin.updateUser);
  r.post('/admin/users/:id/reset-password', requireSuperAdmin, admin.resetPassword);
  r.delete('/admin/users/:id', requireSuperAdmin, admin.deleteUser);

  // ---------- 积分体系 ----------
  const credits = creditRoutes(db, log);
  r.get('/credits/balance', credits.myBalance);
  r.get('/credits/ledger', credits.myLedger);
  r.get('/credits/users/:id/balance', requireSuperAdmin, credits.userBalance);
  r.get('/credits/users/:id/ledger', requireSuperAdmin, credits.userLedger);
  r.post('/credits/users/:id/grant', requireSuperAdmin, credits.grant);
  r.post('/credits/users/:id/deduct', requireSuperAdmin, credits.deduct);
  r.get('/credits/pricing', requireSuperAdmin, credits.listPricing);
  r.post('/credits/pricing', requireSuperAdmin, credits.createPricing);
  r.put('/credits/pricing/:id', requireSuperAdmin, credits.updatePricing);
  r.delete('/credits/pricing/:id', requireSuperAdmin, credits.deletePricing);
  r.get('/credits/stats', requireSuperAdmin, credits.stats);
  r.get('/credits/ledger/global', requireSuperAdmin, credits.globalLedger);
  r.get('/credits/settings', requireSuperAdmin, credits.getSettings);
  r.put('/credits/settings', requireSuperAdmin, credits.updateSettings);

  const drama = dramaRoutes(db, cfg, log);
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const aiConfig = aiConfigRoutes(db, log, cfg);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  
  const uploadService = require('../services/uploadService');
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const storyboards = storyboardRoutes(db, log);
  const images = imageRoutes(db, cfg, log);
  const videos = videoRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const assets = assetRoutes(db, log);
  const audio = audioRoutes(db, log, cfg);
  const promptOverrides = promptOverridesRoutes.routes(db, log);

  // ---------- dramas ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  // 导入（放在 :id 路由前，避免被 :id 捕获）
  const multer = require('multer');
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
  r.post('/dramas/import', importUpload.single('file'), drama.importDrama);
  r.post('/dramas/import-novel', importUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      response.internalError(res, err);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.get('/dramas/:id/export', requireOwnership('drama'), drama.exportDrama);
  r.put('/dramas/:id/outline', requireOwnership('drama'), drama.saveOutline);
  r.get('/dramas/:id/characters', requireOwnership('drama'), drama.getCharacters);
  r.put('/dramas/:id/characters', requireOwnership('drama'), drama.saveCharacters);
  r.put('/dramas/:id/episodes', requireOwnership('drama'), drama.saveEpisodes);
  r.put('/dramas/:id/progress', requireOwnership('drama'), drama.saveProgress);
  r.get('/dramas/:id/props', requireOwnership('drama'), drama.listProps);
  r.get('/dramas/:id', requireOwnership('drama'), drama.getDrama);
  r.put('/dramas/:id', requireOwnership('drama'), drama.updateDrama);
  r.delete('/dramas/:id', requireOwnership('drama'), drama.deleteDrama);

  // ---------- ai-configs ----------
  // 读取（list / get / vendor-lock）：所有登录用户可访问，但非超级管理员看到的 api_key 已脱敏
  // 写入（create / update / delete / test / bulk-update-key 等）：仅超级管理员
  r.get('/ai-configs/vendor-lock', aiConfig.vendorLock);  // 必须在 /:id 之前
  r.get('/ai-configs', aiConfig.list);
  r.get('/ai-configs/:id', aiConfig.get);
  r.post('/ai-configs', requireSuperAdmin, aiConfig.create);
  r.post('/ai-configs/test', requireSuperAdmin, aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', requireSuperAdmin, aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', requireSuperAdmin, aiConfig.modelArkAsset);
  r.put('/ai-configs/bulk-update-key', requireSuperAdmin, aiConfig.bulkUpdateKey);  // 必须在 /:id 之前
  r.put('/ai-configs/:id', requireSuperAdmin, aiConfig.update);
  r.delete('/ai-configs/:id', requireSuperAdmin, aiConfig.delete);

  // ---------- generation (角色生成：AI + 入库 + 任务结果) ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const taskId = characterGenerationService.generateCharacters(db, cfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  // 故事生成：根据梗概 + 风格/类型 生成扩展剧本正文（不创建项目）
  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      const result = await storyGenerationService.generateStory(db, log, body);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && err.message.includes('未配置')) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- character-library ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', requireOwnership('character_library'), charLibrary.get);
  r.put('/character-library/:id', requireOwnership('character_library'), charLibrary.update);
  r.delete('/character-library/:id', requireOwnership('character_library'), charLibrary.delete);

  // ---------- scene-library ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', requireOwnership('scene_library'), sceneLibrary.get);
  r.put('/scene-library/:id', requireOwnership('scene_library'), sceneLibrary.update);
  r.delete('/scene-library/:id', requireOwnership('scene_library'), sceneLibrary.delete);

  // ---------- prop-library ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', requireOwnership('prop_library'), propLibrary.get);
  r.put('/prop-library/:id', requireOwnership('prop_library'), propLibrary.update);
  r.delete('/prop-library/:id', requireOwnership('prop_library'), propLibrary.delete);

  // ---------- characters ----------
  r.post('/characters/batch-generate-images', characters.batchGenerateImages);  // 必须在 :id 之前
  r.get('/characters/:id', requireOwnership('character'), characters.getOne);
  r.put('/characters/:id', requireOwnership('character'), characters.update);
  r.delete('/characters/:id', requireOwnership('character'), characters.delete);
  r.post('/characters/:id/generate-image', requireOwnership('character'), characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', requireOwnership('character'), characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', requireOwnership('character'), characters.generatePrompt);
  r.post('/characters/:id/upload-image', requireOwnership('character'), uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', requireOwnership('character'), characters.putImage);
  r.put('/characters/:id/image-from-library', requireOwnership('character'), characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', requireOwnership('character'), characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', requireOwnership('character'), characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', requireOwnership('character'), characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', requireOwnership('character'), characters.sd2CertifyRefresh);
  r.post('/characters/:id/extract-from-image', requireOwnership('character'), characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', requireOwnership('character'), characters.extractAnchors);

  // ---------- props ----------
  r.post('/props', prop.createProp);  // 创建走 drama_id（在 body 里），不挂 ownership
  r.get('/props/:id', requireOwnership('prop'), prop.getPropById);
  r.put('/props/:id', requireOwnership('prop'), prop.updateProp);
  r.delete('/props/:id', requireOwnership('prop'), prop.deleteProp);
  r.post('/props/:id/generate', requireOwnership('prop'), prop.generateImage);
  r.post('/props/:id/generate-prompt', requireOwnership('prop'), prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', requireOwnership('prop'), prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', requireOwnership('prop'), prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', requireOwnership('prop'), prop.extractPropFromImage);

  // ---------- vision: 从图片提取描述（不依赖已有实体 ID）----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err);
    }
  });

  // ---------- upload ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);

  // ---------- episodes ----------
  r.post('/episodes/:episode_id/storyboards', requireOwnership('episode'), drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', requireOwnership('episode'), prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', requireOwnership('episode'), stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', requireOwnership('episode'), storyboards.episodeStoryboardsGet);
  r.post('/episodes/:episode_id/finalize', requireOwnership('episode'), drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', requireOwnership('episode'), drama.downloadEpisodeVideo);

  // ---------- tasks ----------
  // 任务通过 resource_id 关联到 dramas/episodes 等，前端按需查询；这里不做强制 ownership
  // （任务列表的过滤由 service 层根据传入的 resource id 反查时校验）
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- scenes ----------
  r.post('/scenes', scenes.create);  // body 里带 drama_id
  r.post('/scenes/generate-image', scenes.generateImage);  // 不依赖 :scene_id，由 body 决定
  r.get('/scenes/:scene_id', requireOwnership('scene'), scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', requireOwnership('scene'), scenes.generatePrompt);
  r.put('/scenes/:scene_id', requireOwnership('scene'), scenes.update);
  r.put('/scenes/:scene_id/prompt', requireOwnership('scene'), scenes.updatePrompt);
  r.delete('/scenes/:scene_id', requireOwnership('scene'), scenes.delete);
  r.post('/scenes/:scene_id/generate-four-view-image', requireOwnership('scene'), scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/add-to-library', requireOwnership('scene'), scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', requireOwnership('scene'), scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', requireOwnership('scene'), scenes.extractFromImage);

  // ---------- images ----------
  r.get('/images', images.list);  // list 按 user_id 过滤（service 层）
  r.post('/images', images.create);
  r.post('/images/upload', images.upload);
  r.get('/images/episode/:episode_id/backgrounds', requireOwnership('episode'), images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', requireOwnership('episode'), images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', requireOwnership('episode'), images.episodeBatch);
  r.post('/images/scene/:scene_id', requireOwnership('scene'), images.scene);
  r.get('/images/:id', requireOwnership('image_generation'), images.get);
  r.delete('/images/:id', requireOwnership('image_generation'), images.delete);

  // ---------- videos ----------
  r.get('/videos', videos.list);
  r.post('/videos', videos.create);
  r.post('/videos/image/:image_gen_id', requireOwnership('image_generation'), videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', requireOwnership('episode'), videos.episodeBatch);
  r.get('/videos/:id', requireOwnership('video_generation'), videos.get);
  r.delete('/videos/:id', requireOwnership('video_generation'), videos.delete);

  // ---------- video-merges ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', requireOwnership('video_merge'), videoMerges.get);
  r.delete('/video-merges/:merge_id', requireOwnership('video_merge'), videoMerges.delete);

  // ---------- assets ----------
  r.get('/assets', assets.list);
  r.post('/assets', assets.create);
  r.post('/assets/import/image/:image_gen_id', requireOwnership('image_generation'), assets.importImage);
  r.post('/assets/import/video/:video_gen_id', requireOwnership('video_generation'), assets.importVideo);
  r.get('/assets/:id', requireOwnership('asset'), assets.get);
  r.put('/assets/:id', requireOwnership('asset'), assets.update);
  r.delete('/assets/:id', requireOwnership('asset'), assets.delete);

  // ---------- storyboards ----------
  r.post('/storyboards', storyboards.create);  // body 里带 episode_id
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.get('/storyboards/episode/:episode_id/generate', requireOwnership('episode'), storyboards.episodeStoryboardsGenerate);
  r.post('/storyboards/:id/insert-before', requireOwnership('storyboard'), storyboards.insertBefore);
  r.get('/storyboards/:id', requireOwnership('storyboard'), storyboards.getOne);
  r.put('/storyboards/:id', requireOwnership('storyboard'), storyboards.update);
  r.delete('/storyboards/:id', requireOwnership('storyboard'), storyboards.delete);
  r.post('/storyboards/:id/props', requireOwnership('storyboard'), prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', requireOwnership('storyboard'), storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', requireOwnership('storyboard'), storyboards.framePromptsGet);
  r.post('/storyboards/:id/polish-prompt', requireOwnership('storyboard'), storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', requireOwnership('storyboard'), storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', requireOwnership('storyboard'), storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', requireOwnership('storyboard'), storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', requireOwnership('storyboard'), storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/:id/upscale', requireOwnership('storyboard'), storyboards.upscale);

  // ---------- audio ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- settings ----------
  r.get('/settings/language', settings.getLanguage);
  r.put('/settings/language', settings.updateLanguage);
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', requireSuperAdmin, settings.updateGenerationSettings);

  // ---------- prompt overrides（仅超级管理员）----------
  r.get('/settings/prompts', requireSuperAdmin, promptOverrides.list);
  r.put('/settings/prompts/:key', requireSuperAdmin, promptOverrides.update);
  r.delete('/settings/prompts/:key', requireSuperAdmin, promptOverrides.reset);

  // ---------- scene model map（仅超级管理员）----------
  r.get('/scene-model-map', sceneModelMap.list);
  r.post('/scene-model-map', requireSuperAdmin, sceneModelMap.create);
  r.get('/scene-model-map/:key', sceneModelMap.get);
  r.put('/scene-model-map/:key', requireSuperAdmin, sceneModelMap.update);
  r.delete('/scene-model-map/:key', requireSuperAdmin, sceneModelMap.delete);

  // 启动时将已有的覆盖加载到 promptI18n 内存缓存
  try {
    const promptI18n = require('../services/promptI18n');
    const promptOverridesService = require('../services/promptOverridesService');
    const saved = promptOverridesService.listOverrides(db);
    promptI18n.loadOverridesIntoCache(saved);
  } catch (e) {
    console.warn('Failed to load prompt overrides:', e.message);
  }

  return r;
}

module.exports = { setupRouter };
