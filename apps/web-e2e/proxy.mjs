// A stand-in for Caddy, as on the server: /api/* goes to the API, everything else to the web app. The browser
// checks open the app through it, so what the browser itself sends to /api (telemetry, CSP reports, files) works.
import http from "node:http";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 8080);
const API = Number(process.env.E2E_API_PORT ?? 4000);
const WEB = Number(process.env.E2E_WEB_PORT ?? 3000);

http
  .createServer((req, res) => {
    const port = req.url?.startsWith("/api/") ? API : WEB;
    const up = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(PORT, () => console.log(`proxy on ${PORT}: /api → ${API}, the rest → ${WEB}`));
