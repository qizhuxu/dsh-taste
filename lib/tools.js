/**
 * dsh-taste 的五个工具：把上游四个脚本包成模型可调用的工具，外加一个自检。
 *
 *   taste_status   读打包清单：版本、上游 commit、纳入了哪些技能
 *   taste_draw     抽签定方向（对应 scripts/draw.mjs）
 *   taste_lint     静态源码扫描（对应 scripts/lint.mjs）
 *   taste_inspect  真实浏览器闸门（对应 scripts/inspect.mjs）
 *   taste_assets   检索并下载真实素材（对应 scripts/assets.mjs）
 *
 * 执行一律走 DSH 官方 subprocess 服务、argv 数组、无 shell。
 *
 * @module dsh-taste/tools
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { throwIfAborted } from './exec.js';
import { SKILLS_DIR, readManifest } from './provider.js';

const baseSchema = { type: 'object', additionalProperties: true };

function textRenderer(lines) {
  return (args, value) => [{ type: 'text', text: lines(args, value ?? {}).join('\n') }];
}

function asRecord(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

function optionalString(args, key) {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function stringArray(args, key) {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

/** 技能目录必须是打包进来的，避免把任意路径喂给脚本。 */
function skillDirOf(manifest, dirName) {
  const skill = manifest.skills.find((item) => item.dir === dirName);
  if (skill === undefined) throw new Error(`打包里没有 ${dirName} 技能目录；可用：${manifest.skills.map((item) => item.dir).join(', ')}`);
  return join(SKILLS_DIR, skill.dir);
}

/**
 * 构造五个工具定义。
 * @param cfg - resolveConfig 结果
 * @param runner - createSubprocessRunner 的产物
 */
export function buildTasteTools(cfg, runner) {
  /** 统一执行：node <script> <positional...> <flags...> */
  async function runScript(scriptName, positional, flags, exec, label) {
    throwIfAborted(exec?.signal);
    const manifest = await readManifest();
    const dir = skillDirOf(manifest, 'taste-skill');
    const argv = [cfg.nodePath, join(dir, 'scripts', scriptName), ...positional, ...flags];
    const result = await runner.run(argv, {
      cwd: exec?.agent?.session?.header?.cwd ?? process.cwd(),
      ...(exec?.signal === undefined ? {} : { signal: exec.signal })
    });
    throwIfAborted(exec?.signal);
    return { argv: argv.slice(1).join(' '), label, ...result, ok: result.exitCode === 0 };
  }

  const status = {
    name: 'taste_status',
    description: 'dsh-taste 自检：显示打包版本、上游仓库与 commit、纳入的技能（哪些可自动调用、哪些只按名调用），以及 node 可执行文件。排查问题时先跑这个。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: baseSchema,
      render: textRenderer((_args, value) => {
        const rec = asRecord(value);
        if (rec.ok !== true) return ['dsh-taste 自检：读取打包清单失败 — ' + String(rec.detail ?? '未知原因')];
        const lines = [`dsh-taste ${rec.pluginVersion}（打包于 ${rec.generatedAt}）`, 'node：' + String(rec.nodePath)];
        for (const source of rec.sources ?? []) {
          lines.push(`上游 ${source.repo}#${source.ref} · ${String(source.commit).slice(0, 10)}`);
        }
        lines.push(`纳入 ${rec.skillCount} 个技能：`);
        for (const skill of rec.skills ?? []) {
          lines.push(`- [${skill.modelInvocable ? '自动' : '按名'}] ${skill.name}  （${skill.dir}，${skill.files} 个文件）`);
        }
        if ((rec.skipped ?? []).length > 0) {
          lines.push(`跳过 ${rec.skipped.length} 个上游墓碑目录：${rec.skipped.map((item) => item.dir).join(', ')}`);
        }
        return lines;
      })
    },
    async execute(_rawArgs, exec) {
      throwIfAborted(exec?.signal);
      try {
        const manifest = await readManifest();
        return {
          ok: true,
          pluginVersion: manifest.pluginVersion,
          generatedAt: manifest.generatedAt,
          nodePath: cfg.nodePath,
          rank: cfg.rank,
          sources: manifest.sources ?? [],
          skills: manifest.skills ?? [],
          skillCount: (manifest.skills ?? []).length,
          skipped: manifest.skipped ?? []
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    timeoutMs: 15000
  };

  const draw = {
    name: 'taste_draw',
    description: '用 taste-skill 的抽签脚本给一个项目定下设计方向：从研究库里抽出方向、字体、配色、首屏与分区蓝图，写到 .taste-skill/direction.json。必须先给 sector。',
    parameters: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: '品类，脚本强制要求。saas / dev-tool / ai-product / consumer-app / finance / agency / studio-portfolio / personal-portfolio / ecommerce / physical-product / fashion / hospitality / restaurant / real-estate / architecture / event / health / education / nonprofit / culture / music / other' },
        brief: { type: 'string', description: '一句话说清这个项目是什么' },
        app: { type: 'boolean', description: '按 App 界面（仪表盘、后台、设置）出方向，而不是落地页' },
        kind: { type: 'string', description: '配合 app 使用的具体界面类型' },
        keep: { type: 'string', description: '沿用上一次抽签的槽位，例如 palette,type' },
        out: { type: 'string', description: '输出目录，默认 .taste-skill' },
        args: { type: 'array', items: { type: 'string' }, description: '原样附加的额外参数（如 --alternatives、--photos、--site、--redraw）' }
      },
      required: ['sector']
    },
    output: { schema: baseSchema, render: textRenderer((_args, value) => renderScript(value)) },
    async execute(rawArgs, exec) {
      const args = asRecord(rawArgs);
      const sector = optionalString(args, 'sector');
      if (sector === undefined) throw new Error('sector（参数 sector）为必填。');
      const flags = ['--sector', sector];
      if (optionalString(args, 'brief') !== undefined) flags.push('--brief', optionalString(args, 'brief'));
      if (args.app === true) flags.push('--app');
      if (optionalString(args, 'kind') !== undefined) flags.push('--kind', optionalString(args, 'kind'));
      if (optionalString(args, 'keep') !== undefined) flags.push('--keep', optionalString(args, 'keep'));
      if (optionalString(args, 'out') !== undefined) flags.push('--out', optionalString(args, 'out'));
      flags.push(...stringArray(args, 'args'));
      return runScript('draw.mjs', [], flags, exec, '抽签');
    },
    timeoutMs: 120000
  };

  const lint = {
    name: 'taste_lint',
    description: '用 taste-skill 的静态扫描在渲染前查禁用的写法（渐变、紫色、等宽字、眉标、编号、静置阴影、细线、空泛文案等），带文件:行号。退出码 1 表示有 FAIL，那是结论不是故障。',
    parameters: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: '要扫描的文件或目录；留空则扫当前工作目录' },
        app: { type: 'boolean', description: '按 App 界面放宽部分规则（表格线、面板阴影等）' },
        json: { type: 'boolean', description: '输出 JSON' },
        args: { type: 'array', items: { type: 'string' }, description: '原样附加的额外参数' }
      }
    },
    output: { schema: baseSchema, render: textRenderer((_args, value) => renderScript(value)) },
    async execute(rawArgs, exec) {
      const args = asRecord(rawArgs);
      const flags = [];
      if (args.app === true) flags.push('--app');
      if (args.json === true) flags.push('--json');
      flags.push(...stringArray(args, 'args'));
      return runScript('lint.mjs', stringArray(args, 'files'), flags, exec, '静态检查');
    },
    timeoutMs: 180000
  };

  const inspect = {
    name: 'taste_inspect',
    description: '用 taste-skill 的真实浏览器闸门渲染页面并在 1440/768/390 三档判定：标题行数、眉标、等宽字、编号、阴影、细线、图片数量、是否有动效、居中、空白长度等，并输出截图。退出码 1 表示至少一条 FAIL。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '要检查的页面：本地 HTML 路径或 URL（必填）' },
        out: { type: 'string', description: '截图与 report.json 的输出目录，默认 .taste-skill/inspect' },
        widths: { type: 'string', description: '视口宽度，逗号分隔，默认 1440,768,390' },
        allow: { type: 'string', description: '豁免的规则名，逗号分隔' },
        app: { type: 'boolean', description: '按 App 界面规则判定' },
        film: { type: 'boolean', description: '额外把滚动过程逐帧拍下来' },
        json: { type: 'boolean', description: '输出 JSON' },
        args: { type: 'array', items: { type: 'string' }, description: '原样附加的额外参数' }
      },
      required: ['target']
    },
    output: { schema: baseSchema, render: textRenderer((_args, value) => renderScript(value)) },
    async execute(rawArgs, exec) {
      const args = asRecord(rawArgs);
      const target = optionalString(args, 'target');
      if (target === undefined) throw new Error('target（参数 target）为必填。');
      const flags = [];
      if (optionalString(args, 'out') !== undefined) flags.push('--out', optionalString(args, 'out'));
      if (optionalString(args, 'widths') !== undefined) flags.push('--widths', optionalString(args, 'widths'));
      if (optionalString(args, 'allow') !== undefined) flags.push('--allow', optionalString(args, 'allow'));
      if (args.app === true) flags.push('--app');
      if (args.film === true) flags.push('--film');
      if (args.json === true) flags.push('--json');
      flags.push(...stringArray(args, 'args'));
      return runScript('inspect.mjs', [target], flags, exec, '浏览器检查');
    },
    timeoutMs: 600000
  };

  const assets = {
    name: 'taste_assets',
    description: '用 taste-skill 的素材脚本在开放馆藏里检索真实图片与影像（Openverse、Wikimedia Commons、芝加哥艺术博物馆、大都会博物馆、NASA、Internet Archive），可下载并记录署名。用 --get 下载、--credits 打印署名。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词；支持用 | 分隔多个备选词' },
        video: { type: 'boolean', description: '找短影像而不是照片' },
        maxMb: { type: 'number', description: '影像体积上限（MB）' },
        get: { type: 'boolean', description: '下载命中的素材' },
        credits: { type: 'boolean', description: '打印已下载素材的署名' },
        article: { type: 'boolean', description: '直接指定一个具体条目' },
        args: { type: 'array', items: { type: 'string' }, description: '原样附加的额外参数' }
      }
    },
    output: { schema: baseSchema, render: textRenderer((_args, value) => renderScript(value)) },
    async execute(rawArgs, exec) {
      const args = asRecord(rawArgs);
      const positional = optionalString(args, 'query') === undefined ? [] : [optionalString(args, 'query')];
      const flags = [];
      if (args.video === true) flags.push('--video');
      if (typeof args.maxMb === 'number' && Number.isFinite(args.maxMb)) flags.push('--max-mb', String(args.maxMb));
      if (args.get === true) flags.push('--get');
      if (args.credits === true) flags.push('--credits');
      if (optionalString(args, 'article') !== undefined) flags.push('--article', optionalString(args, 'article'));
      flags.push(...stringArray(args, 'args'));
      return runScript('assets.mjs', positional, flags, exec, '素材检索');
    },
    timeoutMs: 600000
  };

  return [status, draw, lint, inspect, assets];
}

/** 脚本输出的统一呈现：退出码语义 + stdout/stderr。 */
function renderScript(value) {
  const rec = asRecord(value);
  const lines = [];
  const code = rec.exitCode;
  lines.push(`${String(rec.label ?? '脚本')}${rec.ok === true ? '完成' : '以退出码 ' + String(code ?? 'null') + ' 结束'}`);
  if (rec.ok !== true) {
    lines.push('（退出码 1 在 lint / inspect 里表示「有未达标项」，是检查结论，不是执行故障。）');
  }
  const stdout = String(rec.stdout ?? '').trim();
  const stderr = String(rec.stderr ?? '').trim();
  if (stdout !== '') lines.push('', stdout);
  if (stderr !== '') lines.push('', '[stderr] ' + stderr);
  lines.push('', '命令：node ' + String(rec.argv ?? ''));
  return lines;
}
