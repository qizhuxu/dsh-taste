/**
 * dsh-taste —— taste-skill 的 DeepSeek Harness 原生插件。
 *
 * 两件事：
 *  1. 把打包进 skills/ 的上游技能注册成一个 DSH skill provider（`taste-provider`）；
 *  2. 把上游的四个脚本注册成模型可调用的工具（taste_status / draw / lint / inspect / assets）。
 *
 * 结构参考 dsh-oil-ui：插件自带技能 + 用 provider 喂给 DSH，而不是把技能塞进
 * `~/.dsh/skills`。与 dsh-ffmpeg 一致的零运行时依赖。
 *
 * @module dsh-taste
 */

import { resolveConfig } from './config.js';
import { createSubprocessRunner } from './exec.js';
import { createSkillProvider } from './provider.js';
import { buildTasteTools } from './tools.js';

export const name = 'taste';

/**
 * 显式声明注入：apply 里要用 ctx.skills / ctx.tools / ctx.subprocess，
 * 不声明的话宿主会抛 cannot get property ... without inject。
 */
export const inject = ['skills', 'tools', 'subprocess'];

/**
 * 插件入口。
 * @param ctx - 宿主上下文
 * @param config - 插件行配置（可缺省）
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config);
  const disposers = [];

  if (typeof ctx.skills?.registerProvider === 'function') {
    disposers.push(ctx.skills.registerProvider((control) => createSkillProvider(cfg, control)));
  }

  if (typeof ctx.tools?.register === 'function') {
    const runner = createSubprocessRunner((spec) => ctx.subprocess.spawn(spec), cfg.graceMs, cfg.timeoutMs);
    for (const definition of buildTasteTools(cfg, runner)) {
      disposers.push(ctx.tools.register(definition));
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose();
        } catch {
          // 卸载期的清理失败不应该再往外抛
        }
      }
    });
  }
}

export { resolveConfig } from './config.js';
export { createSkillProvider, PROVIDER_NAME, stripFrontmatter } from './provider.js';
export { buildTasteTools } from './tools.js';
export { createSubprocessRunner } from './exec.js';
