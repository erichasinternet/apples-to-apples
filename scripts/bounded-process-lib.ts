import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface BoundedProcessResult {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

export interface BoundedProcessOptions {
  cwd?: string;
  timeoutMs: number;
  terminateGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  onOutput?: (chunk: string) => void;
}

export async function runBoundedProcess(
  command: string,
  args: string[],
  options: BoundedProcessOptions
): Promise<BoundedProcessResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  const terminateGraceMs = options.terminateGraceMs ?? 2_000;
  if (!Number.isFinite(terminateGraceMs) || terminateGraceMs < 0) {
    throw new Error("terminateGraceMs must be a non-negative finite number");
  }

  const startedAt = Date.now();
  const isolatedProcessGroup = process.platform !== "win32";
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    detached: isolatedProcessGroup,
    stdio: ["ignore", "pipe", "pipe"]
  };
  const child = spawn(command, args, spawnOptions);
  const output: Buffer[] = [];
  const appendOutput = (chunk: Buffer): void => {
    output.push(chunk);
    options.onOutput?.(chunk.toString("utf8"));
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  return await new Promise<BoundedProcessResult>((resolve, reject) => {
    let timedOut = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;

    const timeout = setTimeout(() => {
      timedOut = true;
      signalProcess(child, "SIGTERM", isolatedProcessGroup);
      forceTimer = setTimeout(() => {
        signalProcess(child, "SIGKILL", isolatedProcessGroup);
        settleTimer = setTimeout(() => {
          finish(null, "SIGKILL");
        }, 1_000);
      }, terminateGraceMs);
    }, options.timeoutMs);

    const finish = (
      exitCode: number | null,
      signalCode: NodeJS.Signals | null
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      if (settleTimer) clearTimeout(settleTimer);
      resolve({
        exitCode,
        signalCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        output: Buffer.concat(output).toString("utf8")
      });
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      if (settleTimer) clearTimeout(settleTimer);
      reject(error);
    });
    child.once("close", finish);
  });
}

function signalProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  isolatedProcessGroup: boolean
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isolatedProcessGroup && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through when the process group has already exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child exited between the state check and the signal.
  }
}
