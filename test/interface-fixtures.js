import { createServer } from "node:http";

// One fake product with every surface, one with almost none. Assertions are about provenance and honesty:
// facts point at real observations, and missing surfaces come back unknown rather than guessed.
export const FULL = {
  "/": ["text/html", `<!doctype html><html><head><title>Acme API | Widgets</title><meta name="description" content="Widgets over HTTP"></head><body><a href="/docs">Docs</a> <a href="/pricing">Pricing</a> <a href="/docs/authentication">Auth</a><p>Install: npm install -g acme-cli</p></body></html>`],
  "/robots.txt": ["text/plain", "User-agent: GPTBot\nAllow: /\nUser-agent: *\nAllow: /\n"],
  "/llms.txt": ["text/plain", "# Acme\n\n## Widgets\n- [API reference](/docs/api)\n\n## Billing\n- [Pricing](/pricing)\n"],
  "/openapi.json": ["application/json", JSON.stringify({ openapi: "3.1.0", info: { title: "Acme" }, security: [{ apiKey: [] }], tags: [{ name: "widgets", description: "Make widgets" }], components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-Api-Key" } } }, paths: { "/v1/widgets": { get: { tags: ["widgets"], summary: "List widgets", responses: { 200: {} } }, post: { tags: ["widgets"], responses: { 201: {} } } } } })],
  "/pricing.json": ["application/json", JSON.stringify({ product: { name: "Acme", category: "widgets" }, revenue_model: { type: "usage" }, plans: [{ id: "starter", name: "Starter", price: { amount: 20, currency: "USD", period: "month" } }] })],
  "/pricing": ["text/html", "<html><body><h1>Pricing</h1><p>Starter $20/mo. Enterprise: contact sales.</p></body></html>"],
  "/docs": ["text/html", `<html><body><a href="/docs/api">API</a> <a href="/docs/mcp">MCP server</a> Spec at <code>/openapi.json</code></body></html>`],
  "/docs/api": ["text/html", "<html><body>Use your API key in X-Api-Key.</body></html>"],
  "/docs/authentication": ["text/html", "<html><body>Create an API key in the console.</body></html>"],
  "/docs/mcp": ["text/html", "<html><body>Run the Acme MCP server with npx acme-mcp.</body></html>"],
};
export const BARE = {
  "/": ["text/html", "<html><head><title>Bare</title></head><body>Hello</body></html>"],
};
export const PUBLIC_SITE = {
  "/": ["text/html", '<html><head><title>Public Site</title></head><body><a href="/docs">Docs</a></body></html>'],
  "/docs": ["text/html", '<html><body>See /openapi.json for public product information.</body></html>'],
  "/openapi.json": ["application/json", JSON.stringify({
    openapi: "3.1.0", info: { title: "Public website API" }, paths: {
      "/api/agent": { get: { operationId: "readProduct", summary: "Read public product information", responses: { 200: {} } } },
      "/api/evaluation-request": { post: { summary: "Request an evaluation with the person's permission", responses: { 202: {} } } },
    },
  })],
};

export function serve(table) {
  const server = createServer((req, res) => {
    const hit = table[req.url.split("?")[0]];
    if (!hit) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<html><body>404</body></html>");
    }
    res.writeHead(200, { "content-type": hit[0] });
    res.end(hit[1]);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}
