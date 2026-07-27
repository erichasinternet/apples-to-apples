import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runBoundedProcess } from "../../scripts/bounded-process-lib";

describe("bounded process runner", () => {
  it("returns normal process output and exit status", async () => {
    const result = await runBoundedProcess(
      process.execPath,
      ["-e", "console.log('complete')"],
      { timeoutMs: 5_000 }
    );

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("complete");
  });

  it("terminates a stalled process at the hard deadline", async () => {
    const result = await runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 100, terminateGraceMs: 100 }
    );

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(2_000);
    expect(result.signalCode).not.toBeNull();
  });

  it.runIf(process.platform !== "win32")(
    "terminates descendants in the isolated process group",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "ata-bounded-"));
      const marker = path.join(directory, "orphan.txt");
      const grandchild = [
        "const {spawn}=require('node:child_process');",
        `spawn(process.execPath,['-e',${JSON.stringify(
          `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(
            marker
          )}, 'orphan'), 600)`
        )}],{stdio:'ignore'});`,
        "setInterval(() => {}, 1000);"
      ].join("");

      const result = await runBoundedProcess(
        process.execPath,
        ["-e", grandchild],
        { timeoutMs: 100, terminateGraceMs: 100 }
      );
      await new Promise((resolve) => setTimeout(resolve, 800));

      expect(result.timedOut).toBe(true);
      await expect(readFile(marker, "utf8")).rejects.toThrow();
    }
  );
});
