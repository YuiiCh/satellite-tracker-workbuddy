// 合并服务：托管前端静态产物(dist) + 将 /api 反向代理到 FastAPI 后端。
// 同时负责在后端未运行时拉起它，从而整个应用只需占用单一端口(PORT)即可对外发布。
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const DIST = path.join(__dirname, "dist");
const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 8000;
const VENV_PY = path.join(__dirname, "..", "backend", "venv", "bin", "python");
const BACKEND_DIR = path.join(__dirname, "..", "backend");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

// ---------- 拉起后端（若尚未运行） ----------
function backendHealthy() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: BACKEND_HOST, port: BACKEND_PORT, path: "/api/health", timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureBackend() {
  if (await backendHealthy()) {
    console.log("[server] 后端已在运行，跳过启动");
    return;
  }
  console.log("[server] 启动后端 FastAPI ...");
  const child = spawn(
    VENV_PY,
    ["-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", String(BACKEND_PORT)],
    { cwd: BACKEND_DIR, stdio: "inherit", env: process.env },
  );
  child.on("error", (e) => console.error("[server] 后端启动失败:", e.message));
  // 等后端就绪（最多 ~20s）
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await backendHealthy()) {
      console.log("[server] 后端就绪 ✔");
      return;
    }
  }
  console.error("[server] 警告：后端未在预期时间内就绪，/api 请求将返回 502");
}

// ---------- 静态文件服务 ----------
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  let filePath = path.normalize(path.join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (!err) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
      return;
    }
    // SPA 回退：非资源路径返回 index.html
    if (!path.extname(filePath)) {
      fs.readFile(path.join(DIST, "index.html"), (e2, idx) => {
        if (!e2) {
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(idx);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
}

// ---------- 反向代理 /api ----------
function proxyApi(req, res) {
  const options = {
    host: BACKEND_HOST,
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
  };
  const proxy = http.request(options, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  proxy.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "backend unavailable", detail: e.message }));
  });
  req.pipe(proxy);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/api" || url.startsWith("/api/")) {
    proxyApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] 合并服务监听 http://0.0.0.0:${PORT}`);
});

ensureBackend();
