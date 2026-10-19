/**
 * dsh-taste 的插件级测试：不需要 DSH 宿主。
 *
 *  - 用一个假的 ctx 调 apply()，验证 provider 与五个工具都被注册；
 *  - 用 node:child_process 实现一个忠实的 subprocess 垫片（同 done / collected 形状），
 *    让工具真的去执行上游脚本，从而验证 argv 拼装正确、退出码语义正确；
 *  - 断言技能清单与上游 frontmatter 一致（含「按名调用」的策略）。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject, name } from '../lib/index.js';

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

function makeCtx() {
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
  return { ctx, state };
}

let state;
let workdir;
const exec = () => ({ signal: undefined, agent: { session: { header: { cwd: workdir } } } });
const tool = (toolName) => state.tools.find((item) => item.name === toolName);

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-taste-test-'));
  const { ctx, state: s } = makeCtx();
  state = s;
  apply(ctx, {});
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

test('provider.list() 返回打包的 8 个技能，rank 为 380，调用策略与上游 frontmatter 一致', async () => {
  const candidates = await state.providers[0].list({});
  assert.equal(candidates.length, 8);
  const byName = new Map(candidates.map((item) => [item.name, item]));
  assert.deepEqual([...byName.keys()].sort(), [
    'design-taste-frontend',
    'design-taste-frontend-v1',
    'design-taste-frontend-v2-experimental',
    'gpt-taste',
    'high-end-visual-design',
    'industrial-brutalist-ui',
    'minimalist-ui',
    'stitch-design-taste'
  ]);
  for (const candidate of candidates) {
    assert.equal(candidate.rank, 380, candidate.name + ' 的 rank 应为 380');
    assert.equal(candidate.provider, 'taste-provider');
    assert.equal(candidate.resourceBase.kind, 'directory');
  }
  // 上游只在主技能上放开模型调用，其余 7 个是 disable-model-invocation: true
  assert.equal(byName.get('design-taste-frontend').invocation.modelInvocable, true);
  for (const other of [...byName.values()].filter((item) => item.name !== 'design-taste-frontend')) {
    assert.equal(other.invocation.modelInvocable, false, other.name + ' 应只按名调用');
    assert.equal(other.invocation.userInvocable, true, other.name + ' 应仍可按名调用');
  }
});

test('provider.get() 对每个技能都返回去掉了 frontmatter 的正文', async () => {
  const candidates = await state.providers[0].list({});
  for (const candidate of candidates) {
    const skill = await state.providers[0].get(candidate, {});
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

test('taste_status 读出打包版本与上游 commit', async () => {
  const value = await tool('taste_status').execute({}, exec());
  assert.equal(value.ok, true);
  assert.equal(value.skillCount, 8);
  assert.match(value.sources[0].commit, /^[0-9a-f]{40}$/);
  const rendered = tool('taste_status').output.render({}, value)[0].text;
  assert.match(rendered, /dsh-taste 0\.1\.0/);
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

