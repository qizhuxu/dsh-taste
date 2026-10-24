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
 *  - **本地风格单独记账**：upstream.config.json 的 localStyles 列出「上游已删除、但本插件
 *    继续携带」的风格目录。它们只被读取（不复制、不覆盖、不删除），以 origin: "local"
 *    写进清单，且不计入 lock 的 upstreamDirs，因此不影响上游目录集合的比对。
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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

/**
 * 浅克隆上游。**必须显式关掉换行转换**：
 * Windows 上 core.autocrlf 默认会把签出的 LF 变成 CRLF，那样打包内容与上游 git 里的
 * 字节不一致，treeHash 也就不可复现（Linux CI 与 Windows 本地会算出两个值）。
 */
function gitClone(url, ref, work) {
  git(['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-c', 'core.safecrlf=false',
    'clone', '--depth', '1', '--branch', ref, url, work]);
}

/** 打包内容里出现 CR 就说明换行被转换过，属于打包缺陷，要立刻失败而不是悄悄提交。 */
const TEXT_EXT = new Set(['.md', '.markdown', '.json', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.html', '.htm', '.txt', '.sh']);

async function assertNoCrlf(dir) {
  const offenders = [];
  for (const file of await walk(dir)) {
    const dot = file.path.lastIndexOf('.');
    if (dot < 0 || !TEXT_EXT.has(file.path.slice(dot).toLowerCase())) continue;
    const raw = await readFile(join(dir, file.path));
    if (raw.includes(13)) offenders.push(file.path);
  }
  if (offenders.length > 0) {
    throw new Error(
      `打包内容含 CRLF，treeHash 将不可复现（换行被转换过）：${offenders.slice(0, 5).join('、')}` +
      (offenders.length > 5 ? ` 等 ${offenders.length} 个文件` : '')
    );
  }
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

/** 与平台无关的比较：不用 localeCompare（结果随 locale 变），只比代码点。 */
const byCodePoint = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * 遍历目录并给出确定性的文件清单。
 *
 * **顺序必须固定**：treeHash 由这份清单拼出来，而 readdir 的返回顺序并不保证
 * （NTFS 与 ext4 不同）。不排序的话同一份内容在 Windows 与 Linux 上会算出两个
 * treeHash，--check 就会在 CI 上误报漂移——这是实测踩到的坑。
 */
async function walk(dir, base = dir) {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .sort((left, right) => byCodePoint(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, base));
    else if (entry.isFile()) {
      const info = await stat(full);
      const rel = full.slice(base.length + 1).split(sep).join('/');
      const hash = createHash('sha256').update(await readFile(full)).digest('hex').slice(0, 16);
      files.push({ path: rel, bytes: info.size, hash });
    }
  }
  return files;
}

/** treeHash 的唯一入口：先按路径排序再拼串，杜绝遍历顺序带来的漂移。 */
function treeHashOf(files) {
  return createHash('sha256')
    .update([...files].sort((left, right) => byCodePoint(left.path, right.path))
      .map((file) => `${file.path}:${file.hash}`).join('\n'))
    .digest('hex');
}

/**
 * 由**仓库里已就位**的 skills/<dir> 生成清单条目，用于 upstream.config.json 的 localStyles。
 *
 * 与上游目录的区别只有两点：不从这里复制文件（目录本身是本仓库维护的资产），
 * 以及 origin 记为 local（不参与 upstreamDirs 的集合比对）。字段口径与上游条目完全一致，
 * 这样 provider 读清单时不需要区分来源。
 */
async function localStyleEntry(dir) {
  const target = join(SKILLS_OUT, dir);
  const skillFile = join(target, 'SKILL.md');
  if (!existsSync(skillFile)) {
    throw new Error(`localStyles 里的 ${dir} 在 skills/ 下不存在或缺 SKILL.md：请恢复该目录，或把它从 upstream.config.json 的 localStyles 里移除`);
  }
  const raw = await readFile(skillFile, 'utf8');
  const { data, bodyStart } = parseFrontmatter(raw);
  if (typeof data.name !== 'string' || data.name.length === 0) {
    throw new Error(`localStyles 里的 ${dir} frontmatter 缺 name`);
  }
  await assertNoCrlf(target);
  const files = await walk(target);
  return {
    dir,
    name: data.name,
    primary: false,
    description: typeof data.description === 'string' ? data.description : '',
    whenToUse: typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? data.whenToUse : null,
    modelInvocable: !truthy(data['disable-model-invocation']),
    userInvocable: data['user-invocable'] === undefined ? true : truthy(data['user-invocable']),
    source: 'local',
    origin: 'local',
    bodyStart,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    treeHash: treeHashOf(files)
  };
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
    gitClone(url, source.ref, work);
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
      await assertNoCrlf(target);

      const files = await walk(target);
      skills.push({
        dir,
        name: data.name,
        // 主技能：插件默认只把它暴露成一条技能/命令，其余风格进主技能正文里的指令
        primary: dir === source.primary,
        description: typeof data.description === 'string' ? data.description : '',
        whenToUse: typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? data.whenToUse : null,
        modelInvocable: !truthy(data['disable-model-invocation']),
        userInvocable: data['user-invocable'] === undefined ? true : truthy(data['user-invocable']),
        source: source.id,
        origin: 'upstream',
        bodyStart,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        treeHash: treeHashOf(files)
      });
      log(`纳入 ${dir} → ${data.name}（${files.length} 个文件）`);
    }

    const licenseFile = join(work, 'LICENSE');
    if (existsSync(licenseFile)) await cp(licenseFile, join(SKILLS_OUT, 'UPSTREAM-LICENSE.txt'));
  }

  if (!checkOnly) {
    // 上游已删除、但本插件继续携带的风格目录：只读仓库里已就位的副本
    for (const dir of config.localStyles ?? []) {
      const entry = await localStyleEntry(dir);
      skills.push(entry);
      log(`保留本地风格 ${entry.dir} → ${entry.name}（${entry.files} 个文件）`);
    }
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
        const treeHash = treeHashOf(files);
        if (treeHash !== skill.treeHash) {
          drift = true;
          driftReasons.push(`${skill.dir} 内容与清单不符（treeHash ${skill.treeHash.slice(0, 12)} → ${treeHash.slice(0, 12)}），有人改过打包内容`);
        }
      }
      // 1b) 配置里声明的本地风格必须都在清单里，否则风格面会静默消失
      for (const dir of config.localStyles ?? []) {
        if (!localTree.skills.some((item) => item.dir === dir && item.origin === 'local')) {
          drift = true;
          driftReasons.push(`upstream.config.json 声明的本地风格 ${dir} 不在清单里，需要运行 node scripts/vendor.mjs`);
        }
      }
      // 2) **上游**目录集合与锁定文件的一致性（本地风格不计入 upstreamDirs）
      const lock = existsSync(LOCK) ? JSON.parse(await readFile(LOCK, 'utf8')) : null;
      if (lock !== null) {
        const recordedUpstream = [...(lock.upstreamDirs ?? [])].sort().join(',');
        const listedUpstream = [...localTree.skills.filter((item) => item.origin !== 'local').map((item) => item.dir), ...(localTree.skipped ?? []).map((item) => item.dir)].sort().join(',');
        if (recordedUpstream !== listedUpstream) {
          drift = true;
          driftReasons.push(`上游目录集合与锁定文件不一致：lock ${recordedUpstream} / 清单 ${listedUpstream}`);
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

  skills.sort((left, right) => byCodePoint(left.dir, right.dir));
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
    upstreamDirs: skills.filter((item) => item.origin !== 'local').map((item) => item.dir).concat(skipped.map((item) => item.dir)).sort(),
    skipped,
    skills: skills.filter((item) => item.origin !== 'local').map((item) => ({ dir: item.dir, name: item.name, files: item.files, treeHash: item.treeHash }))
  }, null, 2) + '\n', 'utf8');

  await rm(TMP, { recursive: true, force: true });
  log(`完成：${skills.length} 个技能，跳过 ${skipped.length} 个墓碑目录`);
  for (const item of skills) log(`  ${item.modelInvocable ? '自动' : '按名'}  ${item.name}`);
}

main().catch((error) => {
  console.error('[vendor] 失败：' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
