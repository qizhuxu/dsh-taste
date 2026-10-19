/**
 * dsh-taste 配置解析。缺失字段取默认值，非法字段抛中文错误。
 * 与 dsh-ffmpeg / dsh-oil-ui 的风格保持一致：配置坏了要在加载时就报，不要留到工具执行。
 *
 * @module dsh-taste/config
 */

/**
 * 本插件的技能优先级。
 * DSH 的 rank 越小越优先（dsh-skill 的 compareIndexedCandidates 用左减右）：
 *   项目 .dsh/skills = 100 · 项目 .agents/skills = 200 · 自定义 = 300
 *   用户 ~/.dsh/skills = 400 · 用户 ~/.agents/skills = 500 · 内建 = 600
 * 取 380：压过用户级目录里的同名技能（例如用 Junction 装的那一份），
 * 但让项目级 100/200/300 仍然能覆盖插件版本。
 */
const DEFAULT_RANK = 380;

const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_GRACE_MS = 10000;

export function resolveConfig(config) {
  if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
    throw new Error('dsh-taste 配置必须是对象。');
  }
  const cfg = config ?? {};

  if (cfg.nodePath !== undefined && (typeof cfg.nodePath !== 'string' || cfg.nodePath.trim() === '')) {
    throw new Error('nodePath 必须是非空字符串。');
  }
  if (cfg.rank !== undefined && (typeof cfg.rank !== 'number' || !Number.isInteger(cfg.rank) || cfg.rank < 1 || cfg.rank > 10000)) {
    throw new Error('rank 必须是 1–10000 的整数。');
  }
  if (cfg.timeoutMs !== undefined && (typeof cfg.timeoutMs !== 'number' || !Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 10000 || cfg.timeoutMs > 3600000)) {
    throw new Error('timeoutMs 必须是 10000–3600000 的整数（毫秒）。');
  }
  if (cfg.graceMs !== undefined && (typeof cfg.graceMs !== 'number' || !Number.isInteger(cfg.graceMs) || cfg.graceMs < 1000 || cfg.graceMs > 120000)) {
    throw new Error('graceMs 必须是 1000–120000 的整数（毫秒）。');
  }
  if (cfg.exposeOptInSkills !== undefined && typeof cfg.exposeOptInSkills !== 'boolean') {
    throw new Error('exposeOptInSkills 必须是布尔值。');
  }

  return {
    // 用宿主自己的 node 跑脚本；dsh-oil-ui 也是这么做的（process.execPath）
    nodePath: cfg.nodePath?.trim() || process.env.DSH_TASTE_NODE?.trim() || process.execPath,
    rank: cfg.rank ?? DEFAULT_RANK,
    timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    graceMs: cfg.graceMs ?? DEFAULT_GRACE_MS,
    // true 时把上游标记为「按名调用」的技能也放进模型目录（默认尊重上游的 disable-model-invocation）
    exposeOptInSkills: cfg.exposeOptInSkills === true
  };
}
