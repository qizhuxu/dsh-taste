/**
 * 进程执行层：把 DSH 官方 subprocess 服务包装成 Promise 式 runner。
 * 全程 argv 数组、无 shell 解释；超时由 AbortSignal 驱动，宿主负责树级终止。
 * 与 dsh-ffmpeg 的 exec.js 同一套写法。
 *
 * @module dsh-taste/exec
 */

const COLLECT_BYTES = 4 * 1024 * 1024;

/**
 * @param spawn - ctx.subprocess.spawn
 * @param graceMs - SIGTERM 到强杀之间的宽限
 * @param defaultTimeoutMs - 缺省超时
 */
export function createSubprocessRunner(spawn, graceMs, defaultTimeoutMs) {
  return {
    async run(argv, options) {
      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`操作超过 ${timeoutMs}ms 未完成`)), timeoutMs);
      const signal = options?.signal === undefined
        ? controller.signal
        : AbortSignal.any([options.signal, controller.signal]);
      try {
        const handle = spawn({
          argv,
          cwd: options?.cwd ?? process.cwd(),
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: COLLECT_BYTES },
            stderr: { maxBytes: COLLECT_BYTES }
          },
          graceMs,
          signal
        });
        const outcome = await handle.done;
        // done 可能因竞态在取消之后才 resolve：以 signal 状态为准
        if (signal.aborted) throw signal.reason;
        const stdout = handle.collected.stdout?.readFrom(0);
        const stderr = handle.collected.stderr?.readFrom(0);
        if (stdout?.lossy === true || stdout?.truncated === true) {
          throw new Error('脚本输出超过 4MB 已被宿主截断，无法完整解析；请缩小检查范围后重试。');
        }
        return {
          exitCode: outcome.exitCode,
          signal: outcome.signal ?? null,
          stdout: stdout?.text ?? '',
          stderr: stderr?.text ?? ''
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** 已取消则抛出取消原因。 */
export function throwIfAborted(signal) {
  if (signal?.aborted === true) throw signal.reason;
}
