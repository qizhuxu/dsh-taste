/**
 * 技能来源：把打包进本插件的 skills/ 目录注册成一个 DSH skill provider。
 *
 * 运行期**不解析 YAML**：vendor.mjs 在打包时就把 frontmatter 解析进
 * skills/taste.manifest.json，这里只读清单（另用一条正则读 invocation 开关，
 * 见下）。因此插件零运行时依赖，也不会因为上游换了 frontmatter 写法而在加载期炸掉。
 *
 * ## 为什么默认只暴露一个技能
 *
 * DSH 把 userInvocable 的技能变成人面向的 `/命令`。插件里有 8 个技能，如果全列出来，
 * 命令面板就会出现 8 条（`/design-taste-frontend`、`/gpt-taste`、`/minimalist-ui`…），
 * 而 oil-ui 那种「一个插件一条命令」的形态只有 1 条。
 *
 * 所以默认只列出主技能，其余 7 个风格**不单独出现**，改为在加载主技能时把它们的
 * 名称与文件绝对路径追加进正文——需要时模型按指令去读对应文件。想回到 8 条并列的
 * 形态，配置 `listAllStyles: true`。
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

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

/**
 * 从**实时** frontmatter 读 `disable-model-invocation`。
 *
 * 这一条不用 YAML 解析，只要一个正则。存在的意义是让外部工具的开关真正生效：
 * DSH 的技能面板（dsh-client-ui-skill-explorer）的「启用/停用」就是改写这个字段，
 * 而清单是打包时生成的快照——只看清单的话，用户在面板上按开关不会有任何效果。
 * @returns 覆盖值；frontmatter 里没有该字段时返回 undefined（沿用清单）
 */
export function frontmatterModelInvocable(raw) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (frontmatter === null) return undefined;
  const match = /^disable-model-invocation:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter[1]);
  if (match === null) return undefined;
  return !TRUTHY.has(match[1].trim().toLowerCase());
}

/** 主技能之外的其他风格：告诉模型它们在哪、什么时候读。 */
function stylesAddendum(primaryName, styles) {
  if (styles.length === 0) return '';
  const rows = styles.map((style) => `| \`${style.name}\` | ${style.about} | \`${join(SKILLS_DIR, style.dir, 'SKILL.md')}\` |`);
  return `

---

## Other styles shipped in this plugin

This plugin also carries **${styles.length} alternative styles** from the same upstream project.
They are deliberately **not** separate skills and do **not** appear in the command list — the
file below *is* the skill. Read the named file and follow it in place of this one.

| Style (the name a user will say) | What it is | Read this file |
| --- | --- | --- |
${rows.join('\n')}

How to use them:

- Load one **only** when the user names it, or when the brief plainly calls for that style.
  This file (tasteskill v2) stays the default.
- Do **not** blend a named style with this file's run — switching means following that file.
- Each file is self-contained: read it whole, then work as you would from any skill.
`;
}

/** 一句话说明每个风格是什么，用于追加段落的表格（简短，避免正文膨胀）。 */
const STYLE_ABOUT = {
  'gpt-taste': 'Awwwards-level frontend design with GSAP motion',
  'high-end-visual-design': 'expensive, soft look: premium fonts, whitespace, depth',
  'minimalist-ui': 'clean editorial interfaces, strict monochrome (Notion/Linear mood)',
  'industrial-brutalist-ui': 'raw mechanical interfaces, Swiss typography, extreme scale contrast',
  'stitch-design-taste': 'Google Stitch-compatible semantic design rules',
  'design-taste-frontend-v1': 'the original v1, preserved for projects depending on it',
  'design-taste-frontend-v2-experimental': 'the earlier dial-driven v2 (VARIANCE / MOTION / DENSITY)'
};

/**
 * 建 provider。清单按 mtime 缓存；git pull 之后无需重启即可生效。
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

  /** 主技能：清单里 primary 为 true 的那个；没有标记就退回第一个。 */
  const primaryOf = (manifest) => manifest.skills.find((skill) => skill.primary === true) ?? manifest.skills[0];

  /** 要被列出的技能集合。 */
  const listedSkills = (manifest) => {
    if (cfg.listAllStyles === true) return manifest.skills;
    const primary = primaryOf(manifest);
    return primary === undefined ? [] : [primary];
  };

  /** 读实时 frontmatter 决定 modelInvocable，读不到就沿用清单。 */
  const invocationOf = async (skill) => {
    let modelInvocable = skill.modelInvocable !== false;
    try {
      const raw = await readFile(join(SKILLS_DIR, skill.dir, 'SKILL.md'), 'utf8');
      const live = frontmatterModelInvocable(raw);
      if (live !== undefined) modelInvocable = live;
    } catch {
      // 读不到就用清单值，不因为一个开关读失败而整条目录塌掉
    }
    return { modelInvocable, userInvocable: skill.userInvocable !== false };
  };

  const toCandidate = async (skill) => ({
    name: skill.name,
    description: skill.description,
    ...(typeof skill.whenToUse === 'string' && skill.whenToUse.length > 0 ? { whenToUse: skill.whenToUse } : {}),
    invocation: await invocationOf(skill),
    source: 'dsh-taste',
    provider: PROVIDER_NAME,
    path: join(SKILLS_DIR, skill.dir, 'SKILL.md'),
    resourceBase: { kind: 'directory', path: join(SKILLS_DIR, skill.dir) },
    rank: cfg.rank,
    locator: { dir: skill.dir, treeHash: skill.treeHash }
  });

  return {
    name: PROVIDER_NAME,

    async list(options) {
      control.signal.throwIfAborted();
      options?.signal?.throwIfAborted();
      let loaded;
      try {
        loaded = await load();
      } catch {
        // 清单坏了/缺失：报「不完整」让消费者保留上一份可用目录，而不是抛出去清空目录
        return { candidates: [], complete: false };
      }
      if (loaded.manifest === null) return { candidates: [], complete: false };
      const candidates = [];
      for (const skill of listedSkills(loaded.manifest)) candidates.push(await toCandidate(skill));
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

      let content = stripFrontmatter(raw);
      // 单入口模式下，把其他风格以「指令」的形式带出来
      if (cfg.listAllStyles !== true && skill.primary === true) {
        const styles = loaded.manifest.skills
          .filter((item) => item.dir !== skill.dir)
          .map((item) => ({ name: item.name, dir: item.dir, about: STYLE_ABOUT[item.name] ?? item.description.slice(0, 80) }));
        content += stylesAddendum(skill.name, styles);
      }

      return {
        name: skill.name,
        description: skill.description,
        ...(typeof skill.whenToUse === 'string' && skill.whenToUse.length > 0 ? { whenToUse: skill.whenToUse } : {}),
        invocation: await invocationOf(skill),
        source: 'dsh-taste',
        provider: PROVIDER_NAME,
        path,
        resourceBase: { kind: 'directory', path: join(SKILLS_DIR, skill.dir) },
        content
      };
    }
  };
}

/** 读清单（供工具使用）。 */
export async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

export { SKILLS_DIR, MANIFEST_PATH };
