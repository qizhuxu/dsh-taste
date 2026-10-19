/**
 * 技能来源：把打包进本插件的 skills/ 目录注册成一个 DSH skill provider。
 *
 * 运行期**不解析 YAML**：vendor.mjs 在打包时就把 frontmatter 解析进
 * skills/taste.manifest.json，这里只读清单，因此插件零运行时依赖，
 * 也不会因为上游换了 frontmatter 写法而在加载期炸掉。
 *
 * provider 契约（@deepseek-ai/dsh-skill 的 SkillProvider）：
 *   { name, list(options), get(candidate, options) }
 *
 * @module dsh-taste/provider
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROVIDER_NAME = 'taste-provider';

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));
const MANIFEST_PATH = join(SKILLS_DIR, 'taste.manifest.json');

/** 去掉 frontmatter，返回正文（技能正文里出现的 --- 不受影响，只剥开头那一段）。 */
export function stripFrontmatter(raw) {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
  return match === null ? raw : raw.slice(match[0].length);
}

/**
 * 建 provider。清单按 mtime 缓存，git pull 之后无需重启即可生效。
 * @param cfg - resolveConfig 的结果
 * @param control - 注册生命周期（signal / invalidate）
 */
export function createSkillProvider(cfg, control) {
  let cache = null;

  const load = async () => {
    control.signal.throwIfAborted();
    let info;
    try {
      info = await stat(MANIFEST_PATH);
    } catch {
      return { manifest: null, mtimeMs: 0 };
    }
    if (cache !== null && cache.mtimeMs === info.mtimeMs) return cache;
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (!Array.isArray(manifest?.skills)) throw new Error('taste.manifest.json 缺少 skills 数组，请重新运行 node scripts/vendor.mjs');
    cache = { manifest, mtimeMs: info.mtimeMs };
    return cache;
  };

  const modelInvocable = (skill) => (cfg.exposeOptInSkills ? true : skill.modelInvocable !== false);

  return {
    name: PROVIDER_NAME,

    async list(options) {
      control.signal.throwIfAborted();
      options?.signal?.throwIfAborted();
      let loaded;
      try {
        loaded = await load();
      } catch (error) {
        // 清单坏了/缺失：报「不完整」让消费者保留上一份可用目录，而不是抛出去清空目录
        return { candidates: [], complete: false };
      }
      if (loaded.manifest === null) return { candidates: [], complete: false };
      const candidates = loaded.manifest.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(typeof skill.whenToUse === 'string' && skill.whenToUse.length > 0 ? { whenToUse: skill.whenToUse } : {}),
        invocation: { modelInvocable: modelInvocable(skill), userInvocable: skill.userInvocable !== false },
        source: 'dsh-taste',
        provider: PROVIDER_NAME,
        path: join(SKILLS_DIR, skill.dir, 'SKILL.md'),
        resourceBase: { kind: 'directory', path: join(SKILLS_DIR, skill.dir) },
        rank: cfg.rank,
        locator: { dir: skill.dir, treeHash: skill.treeHash }
      }));
      return candidates;
    },

    async get(candidate, options) {
      control.signal.throwIfAborted();
      options?.signal?.throwIfAborted();
      const loaded = await load();
      if (loaded.manifest === null) return undefined;
      const skill = loaded.manifest.skills.find((item) => item.name === candidate.name);
      if (skill === undefined) return undefined;
      // 发现与加载之间目录被换过（例如正好 git pull 了），拒绝这次过期选择
      const locator = candidate.locator;
      if (locator !== null && typeof locator === 'object' && locator.dir !== skill.dir) return undefined;
      const path = join(SKILLS_DIR, skill.dir, 'SKILL.md');
      const raw = await readFile(path, 'utf8');
      control.signal.throwIfAborted();
      return {
        name: skill.name,
        description: skill.description,
        ...(typeof skill.whenToUse === 'string' && skill.whenToUse.length > 0 ? { whenToUse: skill.whenToUse } : {}),
        invocation: { modelInvocable: modelInvocable(skill), userInvocable: skill.userInvocable !== false },
        source: 'dsh-taste',
        provider: PROVIDER_NAME,
        path,
        resourceBase: { kind: 'directory', path: join(SKILLS_DIR, skill.dir) },
        content: stripFrontmatter(raw)
      };
    }
  };
}

/** 读清单（供工具使用）。 */
export async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

export { SKILLS_DIR, MANIFEST_PATH };
