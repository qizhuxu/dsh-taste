#!/usr/bin/env node
/**
 * vendor.mjs —— 把上游 taste-skill 的技能按 commit 固定版本重新封装进本插件。
 *
 *   node scripts/vendor.mjs            # 拉取上游、重建 skills/ 与两个清单
 *   node scripts/vendor.mjs --check    # 只比对：上游是否已前进 / 本地是否被改动，有差异以退出码 1 结束
 *
 * 设计要点：
 *  - **按 commit 固定**：先 `git ls-remote` 解析 ref 到具体 sha，再用该 sha 浅克隆，所以打包结果是可复现的。
 *  - **不解析 YAML**：只提取用得到的 frontmatter 字段（含 `>` / `>-` 折叠块），
 *    解析结果写进 taste.manifest.json，运行期插件只读清单、不碰 YAML。
 *  - **零运行时依赖**：只用 node 内置模块与 git。
 *  - **目录只增不减会被发现**：upstream.lock.json 记录上游 skills/ 下的全部目录名，
 *    上游新增或删除技能时 --check 会报出来。
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.vendor-tmp');
const SKILLS_OUT = join(ROOT, 'skills');
const MANIFEST = join(SKILLS_OUT, 'taste.manifest.json');
const LOCK = join(ROOT, 'upstream.lock.json');

const checkOnly = process.argv.includes('--check');

const log = (...parts) => console.log('[vendor]', ...parts);

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败（${result.status}）：${(result.stderr || result.stdout || '').trim().slice(0, 400)}`);
  }
  return (result.stdout || '').trim();
}

/** 解析 SKILL.md 的 YAML frontmatter 子集：标题键、单行标量、`>`/`|` 折叠与字面块。 */
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { data: {}, bodyStart: 0 };
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(lines[i]);
    if (kv === null) continue;
    const key = kv[1];
    let value = (kv[2] ?? '').trim();
    if (['>', '>-', '>+', '|', '|-', '|+'].includes(value)) {
      const folded = value.startsWith('>');
      const keepTrailing = value.endsWith('+');
      const parts = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() === '') { parts.push(''); i += 1; continue; }
        if (!/^[ \t]/.test(next)) break;
        parts.push(next.replace(/^[ \t]+/, ''));
        i += 1;
      }
      let text = folded
        ? parts.map((part) => part.trim()).join(' ').replace(/[ \t]+/g, ' ').trim()
        : parts.join('\n').replace(/\s+$/, '');
      if (keepTrailing) text += '\n';
      value = text;
    } else {
      value = value.replace(/^["'](.*)["']$/, '$1');
    }
    data[key] = value;
  }
  return { data, bodyStart: match[0].length };
}

const truthy = (value) => value === true || value === 'true' || value === 'yes' || value === 'on';

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, base));
    else if (entry.isFile()) {
      const info = await stat(full);
      const rel = full.slice(base.length + 1).split('\\').join('/');
      const hash = createHash('sha256').update(await readFile(full)).digest('hex').slice(0, 16);
      files.push({ path: rel, bytes: info.size, hash });
    }
  }
  return files;
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'upstream.config.json'), 'utf8'));
  const previousLock = existsSync(LOCK) ? JSON.parse(await readFile(LOCK, 'utf8')) : null;
  const skip = config.skip ?? {};

  await mkdir(TMP, { recursive: true });
  const sources = [];
  const skills = [];
  const skipped = [];
  let drift = false;
  const driftReasons = [];

  for (const source of config.sources) {
    const url = `https://github.com/${source.repo}.git`;
    const remote = git(['ls-remote', url, source.ref]);
    const commit = remote.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error(`解析 ${source.repo}#${source.ref} 失败：${remote.slice(0, 200)}`);

    const prior = previousLock?.sources?.find((item) => item.id === source.id);
    if (prior !== undefined && prior.commit !== commit) {
      drift = true;
      driftReasons.push(`${source.repo} 上游已前进：${prior.commit.slice(0, 8)} → ${commit.slice(0, 8)}`);
    }
    log(`${source.repo}#${source.ref} → ${commit.slice(0, 10)}`);
    sources.push({ id: source.id, repo: source.repo, ref: source.ref, commit, homepage: source.homepage ?? null, license: source.license ?? null });

    if (checkOnly) continue;

    const work = join(TMP, source.id);
    await rm(work, { recursive: true, force: true });
    git(['clone', '--depth', '1', '--branch', source.ref, url, work]);
    const head = git(['rev-parse', 'HEAD'], work);
    if (head !== commit) throw new Error(`${source.id} 克隆到的 HEAD(${head}) 与解析结果(${commit}) 不一致`);

    const upstreamSkills = join(work, source.skillsDir);
    const dirs = (await readdir(upstreamSkills, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (dirs.length === 0) throw new Error(`${source.repo} 的 ${source.skillsDir}/ 下没有技能目录`);

    for (const dir of dirs) {
      const from = join(upstreamSkills, dir);
      const skillFile = join(from, 'SKILL.md');
      if (!existsSync(skillFile)) { log(`跳过 ${dir}：没有 SKILL.md`); continue; }
      const raw = await readFile(skillFile, 'utf8');
      const { data, bodyStart } = parseFrontmatter(raw);
      if (typeof data.name !== 'string' || data.name.length === 0) { log(`跳过 ${dir}：frontmatter 缺 name`); continue; }

      if (skip[dir] !== undefined) {
        skipped.push({ dir, name: data.name, reason: skip[dir] });
        log(`跳过 ${dir}（${data.name}）：${skip[dir]}`);
        continue;
      }

      const target = join(SKILLS_OUT, dir);
      await rm(target, { recursive: true, force: true });
      await cp(from, target, { recursive: true });

      const files = await walk(target);
      skills.push({
        dir,
        name: data.name,
        description: typeof data.description === 'string' ? data.description : '',
        whenToUse: typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? data.whenToUse : null,
        modelInvocable: !truthy(data['disable-model-invocation']),
        userInvocable: data['user-invocable'] === undefined ? true : truthy(data['user-invocable']),
        source: source.id,
        bodyStart,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        treeHash: createHash('sha256').update(files.map((file) => `${file.path}:${file.hash}`).join('\n')).digest('hex')
      });
      log(`纳入 ${dir} → ${data.name}（${files.length} 个文件）`);
    }

    const licenseFile = join(work, 'LICENSE');
    if (existsSync(licenseFile)) await cp(licenseFile, join(SKILLS_OUT, 'UPSTREAM-LICENSE.txt'));
  }

  if (checkOnly) {
    const localTree = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : null;
    if (localTree === null) { drift = true; driftReasons.push('缺少 skills/taste.manifest.json，需要先运行 node scripts/vendor.mjs'); }
    else {
      // 1) 本地已打包的技能目录，逐个重算 treeHash，防止 vendored 内容被就地改动
      for (const skill of localTree.skills) {
        const dir = join(SKILLS_OUT, skill.dir);
        if (!existsSync(dir)) { drift = true; driftReasons.push(`清单里的 ${skill.dir} 目录不存在`); continue; }
        const files = await walk(dir);
        const treeHash = createHash('sha256').update(files.map((file) => `${file.path}:${file.hash}`).join('\n')).digest('hex');
        if (treeHash !== skill.treeHash) {
          drift = true;
          driftReasons.push(`${skill.dir} 内容与清单不符（treeHash ${skill.treeHash.slice(0, 12)} → ${treeHash.slice(0, 12)}），有人改过打包内容`);
        }
      }
      // 2) 上游目录集合与锁定文件的一致性
      const lock = existsSync(LOCK) ? JSON.parse(await readFile(LOCK, 'utf8')) : null;
      if (lock !== null) {
        const recordedUpstream = [...(lock.upstreamDirs ?? [])].sort().join(',');
        const recordedLocal = [...localTree.skills.map((item) => item.dir), ...(localTree.skipped ?? []).map((item) => item.dir)].sort().join(',');
        if (recordedUpstream !== recordedLocal) {
          drift = true;
          driftReasons.push(`上游目录集合与锁定文件不一致：lock ${recordedUpstream} / 本地 ${recordedLocal}`);
        }
      }
      const recorded = localTree.skills.map((item) => item.dir).sort().join(',');
      const live = skills.length === 0 ? recorded : skills.map((item) => item.dir).sort().join(',');
      if (recorded !== live) { drift = true; driftReasons.push(`技能集合与本次解析不一致：清单 ${recorded} / 本次 ${live}`); }
    }
    await rm(TMP, { recursive: true, force: true });
    if (drift) {
      console.log('\n[vendor] 检测到漂移：');
      for (const reason of driftReasons) console.log('  - ' + reason);
      process.exit(1);
    }
    console.log('\n[vendor] 无漂移：本地与上游 commit 一致。');
    return;
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  await writeFile(MANIFEST, JSON.stringify({
    schemaVersion: 1,
    pluginVersion: pkg.version,
    generatedAt: new Date().toISOString(),
    sources,
    skipped,
    skills
  }, null, 2) + '\n', 'utf8');

  await rm(LOCK, { force: true });
  await writeFile(LOCK, JSON.stringify({
    schemaVersion: 1,
    sources,
    upstreamDirs: skills.map((item) => item.dir).concat(skipped.map((item) => item.dir)).sort(),
    skipped,
    skills: skills.map((item) => ({ dir: item.dir, name: item.name, files: item.files, treeHash: item.treeHash }))
  }, null, 2) + '\n', 'utf8');

  await rm(TMP, { recursive: true, force: true });
  log(`完成：${skills.length} 个技能，跳过 ${skipped.length} 个墓碑目录`);
  for (const item of skills) log(`  ${item.modelInvocable ? '自动' : '按名'}  ${item.name}`);
}

main().catch((error) => {
  console.error('[vendor] 失败：' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
