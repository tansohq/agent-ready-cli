import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";

// A test server that listens on every address (listen(0)) can be shadowed: a later bind of 127.0.0.1 to the same
// port succeeds, and requests to 127.0.0.1 go to that other server. In a full run, hosted-same-site.test.js once
// got another test's HTML where it expected its own JSON. Every test server binds 127.0.0.1, the address the
// tests call, so a second bind of that port fails with EADDRINUSE instead.
test("test servers listen on 127.0.0.1, where a second bind of their port is refused", async () => {
  const dir = new URL("./", import.meta.url);
  const offenders = [];
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".js"))) {
    const lines = (await readFile(new URL(name, dir), "utf8")).split("\n");
    lines.forEach((line, i) => { if (/\.listen\(/.test(line) && !/127\.0\.0\.1/.test(line)) offenders.push(`${name}:${i + 1}`); });
  }
  assert.deepEqual(offenders, []);

  const first = createServer();
  await new Promise((resolve) => first.listen(0, "127.0.0.1", resolve));
  const second = createServer();
  const refused = await new Promise((resolve) => { second.once("error", (err) => resolve(err.code)); second.listen(first.address().port, "127.0.0.1", () => resolve("bound")); });
  await new Promise((resolve) => first.close(resolve));
  if (refused === "bound") await new Promise((resolve) => second.close(resolve));
  assert.equal(refused, "EADDRINUSE");
});
