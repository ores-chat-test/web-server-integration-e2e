import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:4311";
const htmxUrl = "https://unpkg.com/htmx.org@2.0.8/dist/htmx.min.js";
const htmxPath = createRequire(import.meta.url).resolve(
  "htmx.org/dist/htmx.min.js",
);
const htmxBytes = await readFile(htmxPath);
const reply = "This is a synthetic preview reply";

test.beforeAll(async ({ request }) => {
  // Refuse real servers, even if a production tunnel accidentally uses this port.
  const readiness = await request.get(`${origin}/readyz`, { maxRedirects: 0 });
  expect(readiness.status()).toBe(204);
  expect(readiness.headers()["x-ores-chat-fixture"]).toBe(
    "synthetic-public-v1",
  );
  expect(createHash("sha384").update(htmxBytes).digest("base64")).toBe(
    "/TgkGk7p307TH7EXJDuUlgG3Ce1UVolAOFopFekQkkXihi5u/6OCvVKyz1W+idaz",
  );
});

test.beforeEach(async ({ page }) => {
  // Exercise the production script tag and SRI, using the identical locked npm
  // distribution so CDN availability is not mistaken for application behavior.
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === htmxUrl) {
      return route.fulfill({
        body: htmxBytes,
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
      });
    }
    if (new URL(url).origin === origin) return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.htmx?.version))
    .toBe("2.0.8");
});

async function send(page, text) {
  await page.getByLabel("Your message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("replies through the Rust API and carries the conversation into follow-ups", async ({
  page,
}) => {
  const firstRequest = page.waitForRequest(
    (request) =>
      request.url() === `${origin}/chat` && request.method() === "POST",
  );
  await send(page, "How do I get started?");
  const first = await firstRequest;
  expect(new URLSearchParams(first.postData()).get("conversation_id")).toBe("");
  await expect(page.getByRole("log")).toContainText(reply);
  await expect(page.locator("#conversation-id")).toHaveValue(
    "preview:conversation",
  );
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "",
  );

  const nextRequest = page.waitForRequest(
    (request) =>
      request.url() === `${origin}/chat` && request.method() === "POST",
  );
  await send(page, "And what next?");
  const next = await nextRequest;
  expect(new URLSearchParams(next.postData()).get("conversation_id")).toBe(
    "preview:conversation",
  );
  const headers = await next.allHeaders();
  expect(headers.authorization).toBeUndefined();
  expect(headers.cookie).toBeUndefined();
  expect(headers["x-ores-chat-delegation"]).toBeUndefined();
  await expect(
    page.getByRole("log").getByText(reply, { exact: false }),
  ).toHaveCount(2);
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([]);
  // HTMX 2.0.8 records only the current path at initialization, even with
  // history disabled. No transcript, draft, session, or credential may persist.
  expect(await page.evaluate(() => Object.entries(sessionStorage))).toEqual([
    ["htmx-current-path-for-history", "/"],
  ]);
  expect(
    await page.evaluate(() => [
      window.htmx.config.historyEnabled,
      window.htmx.config.historyCacheSize,
    ]),
  ).toEqual([false, 0]);
  await expect(page.locator("body")).toHaveAttribute("hx-history", "false");
  expect(await page.context().cookies()).toEqual([]);
});

test("renders a safe upstream error, retains the draft, and can retry", async ({
  page,
}) => {
  await send(page, "simulate outage");
  await expect(page.getByRole("alert")).toContainText("Message not completed");
  await expect(page.getByRole("log")).not.toContainText(reply);
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "simulate outage",
  );
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await send(page, "Please try a normal question");
  await expect(page.getByRole("log")).toContainText(reply);
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "",
  );
});

test("cancel stops waiting without claiming the server request was undone", async ({
  page,
}) => {
  await send(page, "simulate delay");
  await expect(page.locator("#chat-form")).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#chat-status")).toContainText(
    "The server may still finish",
  );
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "simulate delay",
  );
  await expect(page.getByRole("log")).not.toContainText(reply);
  await send(page, "A different question");
  await expect(page.getByRole("log")).toContainText(reply);
});

test("a reply does not erase a new draft typed while waiting", async ({
  page,
}) => {
  await send(page, "simulate delay");
  await expect(page.locator("#chat-form")).toHaveAttribute("aria-busy", "true");
  await page
    .getByLabel("Your message", { exact: true })
    .fill("Keep this follow-up draft");
  await expect(page.getByRole("log")).toContainText(reply, { timeout: 15000 });
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "Keep this follow-up draft",
  );
});

test("starter and clear controls preserve the thread; new conversation resets it", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "How do I get started?",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log")).toContainText(reply);
  await page
    .getByLabel("Your message", { exact: true })
    .fill("Discard this draft");
  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.locator("#conversation-id")).toHaveValue(
    "preview:conversation",
  );
  await page.getByRole("link", { name: "New conversation" }).click();
  await expect(page.locator("#conversation-id")).toHaveValue("");
  await expect(page.getByRole("log")).not.toContainText(reply);
});

test("untrusted message markup is rendered only as text", async ({ page }) => {
  const markup = '<img src=x onerror="window.injected=true">';
  await send(page, markup);
  await expect(page.getByRole("log")).toContainText(markup);
  await expect(page.getByRole("log")).toContainText(reply);
  await expect(page.getByRole("log").locator("img,script,iframe")).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test("native forms work with JavaScript disabled and preserve rejected input", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await send(page, "simulate outage");
    await expect(page.getByRole("alert")).toContainText(
      "Message not completed",
    );
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
      "simulate outage",
    );
    await send(page, "A normal native form message");
    await expect(page.getByRole("log")).toContainText(reply);
    await expect(page.locator("#conversation-id")).toHaveValue(
      "preview:conversation",
    );
  } finally {
    await context.close();
  }
});

test("HTTP boundary rejects foreign origins and privileged credentials", async ({
  request,
}) => {
  for (const headers of [
    { Origin: "https://untrusted.invalid" },
    { Origin: origin, Authorization: "Bearer synthetic-not-a-credential" },
    { Origin: origin, "X-ORES-Chat-Delegation": "synthetic-not-a-credential" },
    { Origin: origin, "Sec-Fetch-Site": "cross-site" },
    {},
  ]) {
    const response = await request.post(`${origin}/chat`, {
      headers,
      form: { message: "Synthetic boundary test", conversation_id: "" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain(reply);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

test("layout fits the viewport, keyboard navigation works, and axe finds no violations", async ({
  page,
}) => {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to assistant" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#assistant")).toBeFocused();
  await page.getByText("What can I ask here?", { exact: true }).click();
  await expect(
    page.getByText("Ask about this website and its services.", {
      exact: false,
    }),
  ).toBeVisible();
  const initial = await new AxeBuilder({ page }).analyze();
  expect(initial.violations).toEqual([]);
  await send(page, "simulate outage");
  await expect(page.getByRole("alert")).toBeVisible();
  const failure = await new AxeBuilder({ page }).analyze();
  expect(failure.violations).toEqual([]);
  await send(page, "Check the completed exchange");
  await expect(page.getByRole("log")).toContainText(reply);
  const completed = await new AxeBuilder({ page }).analyze();
  expect(completed.violations).toEqual([]);
});
