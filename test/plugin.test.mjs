/**
 * dsh-taste 的插件级测试：不需要 DSH 宿主。
 *
 *  - 用一个假的 ctx 调 apply()，验证 provider 与五个工具都被注册；
 *  - 用 node:child_process 实现一个忠实的 subprocess 垫片（同 done / collected 形状），
 *    让工具真的去执行上游脚本，从而验证 argv 拼装正确、退出码语义正确；
 *  - 验证「单入口」行为：默认只列出一个技能（skills 面只有一条命令），
 *    其余风格以指令形式写进主技能正文；listAllStyles: true 时回到 8 条并列。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject, name } from '../lib/index.js';
import { frontmatterModelInvocable, SKILLS_DIR, stripFrontmatter } from '../lib/provider.js';

/** 忠实模拟 DSH 的 subprocess.spawn 契约：handle.done + handle.collected.*.readFrom(0)。 */
function makeSpawnShim() {
  const calls = [];
  const spawnShim = (spec) => {
    calls.push(spec.argv);
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    return {
      done: new Promise((resolve) => child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))),
      collected: {
        stdout: { readFrom: () => ({ text: stdout, lossy: false, truncated: false }) },
        stderr: { readFrom: () => ({ text: stderr, lossy: false, truncated: false }) }
      }
    };
  };
  return { spawnShim, calls };
}

function makeCtx(config) {
  const { spawnShim, calls } = makeSpawnShim();
  const state = { providers: [], tools: [], spawnCalls: calls, disposed: 0 };
  const ctx = {
    skills: {
      registerProvider(create) {
        const control = { signal: new AbortController().signal, invalidate() {} };
        state.providers.push(create(control));
        return () => { state.disposed += 1; };
      }
    },
    tools: { register: (definition) => { state.tools.push(definition); return () => { state.disposed += 1; }; } },
    subprocess: { spawn: spawnShim },
    on: () => {},
    logger: { warn() {}, info() {} }
  };
  apply(ctx, config);
  return state;
}

const ALL_STYLES = [
  'design-taste-frontend',
  'design-taste-frontend-v1',
  'design-taste-frontend-v2-experimental',
  'gpt-taste',
  'high-end-visual-design',
  'industrial-brutalist-ui',
  'minimalist-ui',
  'stitch-design-taste'
];

let state;
let allState;
let workdir;
const exec = () => ({ signal: undefined, agent: { session: { header: { cwd: workdir } } } });
const tool = (toolName) => state.tools.find((item) => item.name === toolName);

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-taste-test-'));
  state = makeCtx({});                                  // 默认：单入口
  allState = makeCtx({ listAllStyles: true });          // 可选：8 条并列
});

after(async () => {
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true });
});

test('插件声明了正确的 name 与 inject', () => {
  assert.equal(name, 'taste');
  assert.deepEqual([...inject].sort(), ['skills', 'subprocess', 'tools']);
});

test('apply() 注册了一个 skill provider 与五个工具', () => {
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].name, 'taste-provider');
  assert.deepEqual(
    state.tools.map((item) => item.name).sort(),
    ['taste_assets', 'taste_draw', 'taste_inspect', 'taste_lint', 'taste_status']
  );
  for (const definition of state.tools) {
    assert.equal(typeof definition.description, 'string');
    assert.equal(definition.parameters.type, 'object');
    assert.equal(typeof definition.execute, 'function');
  }
});

test('默认只列出一个技能，skills 面因此只有一条命令', async () => {
  const candidates = await state.providers[0].list({});
  assert.equal(candidates.length, 1, '默认应只列出主技能');
  const [only] = candidates;
  assert.equal(only.name, 'design-taste-frontend');
  assert.equal(only.rank, 380);
  assert.equal(only.provider, 'taste-provider');
  assert.equal(only.invocation.modelInvocable, true);
  assert.equal(only.invocation.userInvocable, true);
  assert.equal(only.resourceBase.kind, 'directory');
});

test('listAllStyles: true 时回到 8 个技能并列（调用策略与上游 frontmatter 一致）', async () => {
  const candidates = await allState.providers[0].list({});
  assert.equal(candidates.length, 8);
  const byName = new Map(candidates.map((item) => [item.name, item]));
  assert.deepEqual([...byName.keys()].sort(), ALL_STYLES);
  for (const candidate of candidates) {
    assert.equal(candidate.rank, 380, candidate.name + ' 的 rank 应为 380');
    assert.equal(candidate.provider, 'taste-provider');
    assert.equal(candidate.resourceBase.kind, 'directory');
  }
  assert.equal(byName.get('design-taste-frontend').invocation.modelInvocable, true);
  for (const other of [...byName.values()].filter((item) => item.name !== 'design-taste-frontend')) {
    assert.equal(other.invocation.modelInvocable, false, other.name + ' 应只按名调用');
    assert.equal(other.invocation.userInvocable, true, other.name + ' 应仍可按名调用');
  }
});

test('主技能正文末尾追加了其他风格的指令与文件绝对路径', async () => {
  const candidates = await state.providers[0].list({});
  const skill = await state.providers[0].get(candidates[0], {});
  assert.ok(skill.content.includes('Other styles shipped in this plugin'), '应有其他风格段落');
  assert.ok(skill.content.includes('| `gpt-taste` |'), '应列出 gpt-taste');
  // 7 个其他风格，每个都要给出可读的绝对路径
  for (const style of ALL_STYLES.filter((item) => item !== 'design-taste-frontend')) {
    assert.ok(skill.content.includes('`' + style + '`'), '应提到 ' + style);
  }
  assert.ok(skill.content.includes(join(SKILLS_DIR, 'gpt-tasteskill', 'SKILL.md')), '应给出绝对路径');
  assert.ok(skill.content.includes('Do **not** blend a named style'), '应说明不要混用');
  // 正文仍然不含 frontmatter
  assert.ok(!skill.content.startsWith('---'));
});

test('listAllStyles 模式下不追加其他风格段落', async () => {
  const candidates = await allState.providers[0].list({});
  const primary = candidates.find((item) => item.name === 'design-taste-frontend');
  const skill = await allState.providers[0].get(primary, {});
  assert.ok(!skill.content.includes('Other styles shipped in this plugin'), '并列模式下无需追加');
});

test('provider.get() 对每个技能都返回去掉了 frontmatter 的正文', async () => {
  const candidates = await allState.providers[0].list({});
  for (const candidate of candidates) {
    const skill = await allState.providers[0].get(candidate, {});
    assert.ok(skill !== undefined, candidate.name + ' 应能加载');
    assert.equal(skill.name, candidate.name);
    assert.equal(skill.provider, 'taste-provider');
    assert.ok(skill.content.length > 200, candidate.name + ' 正文不应为空');
    assert.ok(!skill.content.startsWith('---'), candidate.name + ' 正文不应残留 frontmatter');
  }
});

test('provider.get() 对陌生候选返回 undefined（不抛异常）', async () => {
  const skill = await state.providers[0].get({ name: 'not-a-real-skill', locator: null }, {});
  assert.equal(skill, undefined);
});

test('frontmatterModelInvocable 能读出外部工具的启用/停用开关', () => {
  assert.equal(frontmatterModelInvocable('---\nname: x\ndisable-model-invocation: true\n---\nbody'), false);
  assert.equal(frontmatterModelInvocable('---\nname: x\ndisable-model-invocation: false\n---\nbody'), true);
  assert.equal(frontmatterModelInvocable('---\nname: x\ndisable-model-invocation: on\n---\n'), false);
  assert.equal(frontmatterModelInvocable('---\nname: x\n---\nbody'), undefined, '没有该字段应返回 undefined');
  assert.equal(frontmatterModelInvocable('no frontmatter'), undefined);
});

test('技能面板改写 frontmatter 后，provider 立刻反映（不再只认打包快照）', async () => {
  const skillFile = join(SKILLS_DIR, 'taste-skill', 'SKILL.md');
  const original = await readFile(skillFile, 'utf8');
  try {
    await writeFile(skillFile, original.replace(/^name:/m, 'disable-model-invocation: true\nname:'), 'utf8');
    const off = await state.providers[0].list({});
    assert.equal(off[0].invocation.modelInvocable, false, '改成 true 后应变为不可模型调用');
    await writeFile(skillFile, original, 'utf8');
    const on = await state.providers[0].list({});
    assert.equal(on[0].invocation.modelInvocable, true, '还原后应恢复');
  } finally {
    await writeFile(skillFile, original, 'utf8');
  }
});

test('stripFrontmatter 只剥开头那一段', () => {
  assert.equal(stripFrontmatter('---\na: 1\n---\nbody\n---\nmore'), 'body\n---\nmore');
  assert.equal(stripFrontmatter('no frontmatter'), 'no frontmatter');
});

test('taste_status 读出打包版本与上游 commit', async () => {
  const value = await tool('taste_status').execute({}, exec());
  assert.equal(value.ok, true);
  assert.equal(value.skillCount, 8, '插件仍然携带 8 个技能，只是默认只暴露 1 个');
  assert.match(value.sources[0].commit, /^[0-9a-f]{40}$/);
  const rendered = tool('taste_status').output.render({}, value)[0].text;
  assert.match(rendered, /dsh-taste 0\.2\.0/);
  assert.match(rendered, /纳入 8 个技能/);
});

test('taste_draw 缺 sector 时明确报错（脚本强制要求该参数）', async () => {
  await assert.rejects(() => tool('taste_draw').execute({}, exec()), /sector/);
});

test('taste_inspect 缺 target 时明确报错', async () => {
  await assert.rejects(() => tool('taste_inspect').execute({}, exec()), /target/);
});

test('taste_lint 真的跑起来，并对含禁用写法的页面以退出码 1 报告结论', async () => {
  const page = join(workdir, 'bad.html');
  await writeFile(page, '<style>.a{box-shadow:0 2px 4px #000;background:linear-gradient(red,blue);font-family:ui-monospace}</style>', 'utf8');
  const value = await tool('taste_lint').execute({ files: [page] }, exec());
  assert.equal(value.ok, false, '有 FAIL 时 ok 应为 false');
  assert.equal(value.exitCode, 1);
  assert.match(value.stdout, /FAIL/);
  assert.ok(state.spawnCalls.some((argv) => argv.some((item) => String(item).endsWith('lint.mjs'))), '应真的调用了 lint.mjs');
  const rendered = tool('taste_lint').output.render({}, value)[0].text;
  assert.match(rendered, /退出码 1/);
  assert.match(rendered, /是检查结论，不是执行故障/);
});

test('taste_lint 对干净页面以退出码 0 结束', async () => {
  const page = join(workdir, 'good.html');
  await writeFile(page, '<style>body{background:#101010;color:#f5f5f5;font-size:17px;line-height:1.6}h1{font-size:2.5rem}</style><h1>干净的一页</h1>', 'utf8');
  const value = await tool('taste_lint').execute({ files: [page] }, exec());
  assert.equal(value.exitCode, 0, '干净页面应为 0，实际 stderr：' + value.stderr);
  assert.equal(value.ok, true);
});

test('taste_draw 真的抽出方向单并写到磁盘', async () => {
  const value = await tool('taste_draw').execute({ sector: 'ecommerce', brief: 'a micro-roastery selling a monthly subscription', out: '.taste-skill' }, exec());
  assert.equal(value.exitCode, 0, 'stderr：' + value.stderr);
  assert.match(value.stdout, /DIRECTION SHEET/);
  const direction = JSON.parse(await readFile(join(workdir, '.taste-skill', 'direction.json'), 'utf8'));
  assert.equal(typeof direction.palette.bg, 'string');
  assert.equal(typeof direction.type.display.family, 'string');
});

test('taste_inspect 真的启动浏览器并在三档视口判定', async () => {
  const page = join(workdir, 'page.html');
  await writeFile(page, '<style>body{margin:0;background:#12100e;color:#f2efe9;font:17px/1.6 system-ui}h1{font-size:44px;max-width:14ch;padding:48px}p{padding:0 48px}</style><h1>一周只烘两次</h1><p>单批 6 公斤，焙煎日起 14 天内喝完。</p>', 'utf8');
  const value = await tool('taste_inspect').execute({ target: page, out: 'inspect-out', json: true }, exec());
  assert.match(value.stdout, /viewports/, '应输出量测 JSON');
  const report = JSON.parse(await readFile(join(workdir, 'inspect-out', 'report.json'), 'utf8'));
  assert.equal(report.viewports.length, 3, '应在 1440/768/390 三档各测一次');
  assert.deepEqual(report.viewports.map((item) => item.width), [1440, 768, 390]);
});
