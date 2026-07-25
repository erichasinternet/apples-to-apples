import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repositoryRoot, "tests", "e2e", "site");
const reviewWorkbenchRoot = path.join(repositoryRoot, "review-workbench");
const port = Number(process.env.PORT || 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const isReviewWorkbench = url.pathname === "/review-workbench" ||
    url.pathname.startsWith("/review-workbench/");
  const root = isReviewWorkbench ? reviewWorkbenchRoot : siteRoot;
  const requestedPath = isReviewWorkbench
    ? url.pathname.replace(/^\/review-workbench\/?/, "")
    : url.pathname;
  const cleanPath = decodeURIComponent(requestedPath).replace(/^\/+/, "") || "index.html";
  const filePath = path.resolve(root, cleanPath);

  if (
    (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) ||
    !existsSync(filePath)
  ) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes.get(path.extname(filePath)) || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fixture server listening at http://127.0.0.1:${port}`);
});
