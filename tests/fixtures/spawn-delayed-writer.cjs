const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");

const mode = process.argv[2];
const marker = process.argv[3];

if (!marker) {
  throw new Error("marker path is required");
}

if (mode === "write") {
  setTimeout(() => writeFileSync(marker, "orphan"), 600);
} else {
  spawn(process.execPath, [__filename, "write", marker], { stdio: "ignore" });
  setInterval(() => {}, 1_000);
}
