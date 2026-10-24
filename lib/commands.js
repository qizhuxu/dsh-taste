/**
 * dsh-taste 的两个原生命令：把「结论自明」的两道闸门做成 `/` 命令。
 *
 *   /taste-lint     渲染前静态扫描（scripts/lint.mjs）
 *   /taste-inspect  渲染后真实浏览器三档判定 + 截图（scripts/inspect.mjs）
 *
 * 为什么只做这两个：它们是同一套工作流里**反复要跑**的检查点，输出是脚本直接给出的
 * 确定结论（FAIL 清单 / 三档判定），原样呈现就够用；做成命令后不需要经过模型、
 * 不花 token。`taste_draw` 发三个方向要人挑、`taste_assets` 要人挑图，
 * 判断留在工具侧更合适；`taste_status` 是低频排查，模型调用它几乎零成本。
 *
 * 实现上**不重写执行与渲染**：命令直接复用 tools.js 的同名工具定义，
 * argv 拼装、超时、4MB 截断、退出码语义都只有一份实现。
 *
 * 退出码语义：lint / inspect 的 **1 表示「有未达标项」**，是检查结论而不是执行故障，
 * 因此按 `kind: 'success'` 呈现；只有真正的执行失败（无输出、退出码 ≥2、参数错误）
 * 才回 `kind: 'error'`。
 *
 * @module dsh-taste/commands
 */

/** lint / inspect 用退出码 1 表示「有未达标项」，是结论不是故障。 */
const FINDINGS_EXIT_CODE = 1;

/**
 * 极简 argv 切分：只认双引号包裹与 `\"` 转义，不做任何 shell 解释。
 * 路径含空格时写 `"C:\a b\index.html"`。
 * @param rawInput - 命令名之后的原文
 * @returns 切分后的 token
 */
export function splitArgs(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (text === '') return [];
  const tokens = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '"') { current += '"'; index += 1; started = true; continue; }
    if (char === '"') { quoted = !quoted; started = true; continue; }
    if (quoted === false && /\s/.test(char)) {
      if (started) { tokens.push(current); current = ''; started = false; }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * 解析 `--flag` / `--flag=value` / `--key value`，认不出来的 flag 原样透传给脚本。
 * @param tokens - splitArgs 的产物
 * @param booleanFlags - flag → 工具参数名
 * @param valueFlags - flag → 工具参数名
 * @returns `{ positional, values, passThrough }`
 */
function parseFlags(tokens, booleanFlags, valueFlags) {
  const positional = [];
  const values = {};
  const passThrough = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('--') === false) { positional.push(token); continue; }
    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    if (booleanFlags.has(name) === true) { values[booleanFlags.get(name)] = true; continue; }
    if (valueFlags.has(name) === true) {
      const value = inline === undefined ? tokens[index + 1] : inline;
      if (value === undefined || value.startsWith('--') === true) throw new Error(`${name} 缺少取值`);
      values[valueFlags.get(name)] = value;
      if (inline === undefined) index += 1;
      continue;
    }
    passThrough.push(token);
    const next = tokens[index + 1];
    if (inline === undefined && next !== undefined && next.startsWith('--') === false) { passThrough.push(next); index += 1; }
  }
  return { positional, values, passThrough };
}

const LINT_BOOLEAN_FLAGS = new Map([['--app', 'app'], ['--json', 'json']]);
const LINT_VALUE_FLAGS = new Map();
const INSPECT_BOOLEAN_FLAGS = new Map([['--app', 'app'], ['--film', 'film'], ['--json', 'json']]);
const INSPECT_VALUE_FLAGS = new Map([['--out', 'out'], ['--widths', 'widths'], ['--allow', 'allow']]);

/** 把工具返回值渲染成给人看的文本，并按退出码语义决定 kind。 */
async function runTool(tool, args, invocation) {
  let value;
  try {
    value = await tool.execute(args, { signal: invocation?.signal, agent: invocation?.agent });
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
  }
  let text = '';
  try {
    const parts = tool.output?.render?.(args, value) ?? [];
    text = parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).filter((line) => line !== '').join('\n');
  } catch {
    text = String(value?.stdout ?? value?.stderr ?? '');
  }
  const exitCode = typeof value?.exitCode === 'number' ? value.exitCode : undefined;
  if (exitCode === 0 || exitCode === FINDINGS_EXIT_CODE) return { kind: 'success', text };
  return { kind: 'error', text: text === '' ? `脚本以退出码 ${String(exitCode ?? 'null')} 结束且没有输出` : text };
}

/**
 * 由 tools.js 的工具定义生成两条原生命令。
 * @param tools - `buildTasteTools()` 的产物
 * @returns CommandDefinition 数组（lint 在前）
 */
export function buildTasteCommands(tools) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const lint = byName.get('taste_lint');
  const inspect = byName.get('taste_inspect');
  if (lint === undefined || inspect === undefined) {
    throw new Error('buildTasteCommands 需要 buildTasteTools() 的产物（缺 taste_lint / taste_inspect）');
  }

  const lintCommand = {
    name: 'taste-lint',
    description: 'taste-skill 静态扫描：渐变、紫色、等宽字、眉标、编号、静置阴影、细线、空泛文案等，输出带文件:行号。退出码 1 表示有未达标项，是结论不是故障。',
    input: { hint: '<文件或目录…> [--app] [--json]' },
    async handler(invocation) {
      let parsed;
      try {
        parsed = parseFlags(splitArgs(invocation?.rawInput), LINT_BOOLEAN_FLAGS, LINT_VALUE_FLAGS);
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
      const args = { ...parsed.values };
      if (parsed.positional.length > 0) args.files = parsed.positional;
      if (parsed.passThrough.length > 0) args.args = parsed.passThrough;
      return runTool(lint, args, invocation);
    }
  };

  const inspectCommand = {
    name: 'taste-inspect',
    description: 'taste-skill 真实浏览器闸门：在 1440/768/390 三档判定并截图，输出 report.json。退出码 1 表示至少一条 FAIL。',
    input: { hint: '<页面路径或 URL> [--out 目录] [--widths a,b] [--allow 规则] [--app] [--film] [--json]' },
    async handler(invocation) {
      let parsed;
      try {
        parsed = parseFlags(splitArgs(invocation?.rawInput), INSPECT_BOOLEAN_FLAGS, INSPECT_VALUE_FLAGS);
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
      const target = parsed.positional[0];
      if (target === undefined) {
        return { kind: 'error', text: '用法：/taste-inspect <页面路径或 URL> [--out 目录] [--widths 1440,768,390] [--allow 规则] [--app] [--film] [--json]' };
      }
      const args = { target, ...parsed.values };
      const extra = [...parsed.positional.slice(1), ...parsed.passThrough];
      if (extra.length > 0) args.args = extra;
      return runTool(inspect, args, invocation);
    }
  };

  return [lintCommand, inspectCommand];
}
