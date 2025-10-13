import test from "node:test";
import assert from "node:assert/strict";
import nock from "nock";
import { crawlLinks } from "../utils/crawl.js";

const base = "http://example.com";
const html = `
<html>
  <body>
    <a href="/about">About</a>
    <a href="http://external.com/page">External</a>
  </body>
</html>
`;

nock.disableNetConnect();

test.afterEach(() => {
  nock.cleanAll();
});

test.after(() => {
  nock.enableNetConnect();
});

test("crawl respects internal depth limit", async () => {
  nock(base)
    .get("/about")
    .reply(200, "<html><body><a href='/team'>Team</a></body></html>")
    .get("/team")
    .reply(200, "<html><body><p>Team</p></body></html>");

  const result = await crawlLinks({ baseUrl: base, html, maxInternal: 1, maxExternal: 0 });
  assert.deepEqual(result.docUrls.sort(), ["http://example.com/about"].sort());
});

test("crawl includes external links when allowed", async () => {
  nock("http://external.com")
    .get("/page")
    .reply(200, "<html><body><p>External</p></body></html>");

  const result = await crawlLinks({ baseUrl: base, html, maxInternal: 0, maxExternal: 1 });
  assert.deepEqual(result.docUrls, ["http://external.com/page"]);
});

test("crawl unlimited depth when set to -1", async () => {
  nock(base)
    .get("/about")
    .reply(200, "<html><body><a href='/team'>Team</a></body></html>")
    .get("/team")
    .reply(200, "<html><body><a href='/history'>History</a></body></html>")
    .get("/history")
    .reply(200, "<html><body>History</body></html>");

  const result = await crawlLinks({ baseUrl: base, html, maxInternal: -1, maxExternal: 0 });
  assert.deepEqual(result.docUrls.sort(), [
    "http://example.com/about",
    "http://example.com/team",
    "http://example.com/history",
  ].sort());
});
