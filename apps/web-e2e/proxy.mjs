// A stand-in for Caddy, as on the server: /api/* goes to the API, everything else to the web app. The browser
// checks open the app through it, so what the browser itself sends to /api (telemetry, CSP reports, files) works.
//
// And the counting door (E2E_COUNT_PORT): the web app's own way to the API during the checks (playwright.config.ts
// gives it as API_URL). It passes everything on unchanged and counts the calls of a page that asks to be counted:
// a request whose user-agent ends with "page-cost/<tag>" (the web app passes the browser's user-agent on to the
// API). GET /__page-cost/<tag> on that port answers what the page asked for (page-cost-flows.spec.ts).
import http from "node:http";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 8080);
const API = Number(process.env.E2E_API_PORT ?? 4000);
const WEB = Number(process.env.E2E_WEB_PORT ?? 3000);
const COUNT = Number(process.env.E2E_COUNT_PORT ?? 4001);

/** Sends a request on to a local port as it came, and the answer back as it comes. */
function pass(req, res, port) {
  const up = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
}

http
  .createServer((req, res) => pass(req, res, req.url?.startsWith("/api/") ? API : WEB))
  .listen(PORT, () => console.log(`proxy on ${PORT}: /api → ${API}, the rest → ${WEB}`));

/** What each counted page asked the API for, by its tag: "GET /orders/…" once per call. */
const asked = new Map();
const TAG = /page-cost\/([\w-]+)\s*$/;
const ANSWER = /^\/__page-cost\/([\w-]+)$/;

http
  .createServer((req, res) => {
    const wanted = ANSWER.exec(req.url ?? "");
    if (wanted) {
      const calls = asked.get(wanted[1]) ?? [];
      asked.delete(wanted[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ calls }));
      return;
    }
    const tag = TAG.exec(String(req.headers["user-agent"] ?? ""))?.[1];
    if (tag) asked.set(tag, [...(asked.get(tag) ?? []), `${req.method} ${(req.url ?? "").replace(/^\/api/, "").split("?")[0]}`]);
    pass(req, res, API);
  })
  .listen(COUNT, () => console.log(`counting door on ${COUNT}: everything → ${API}`));
