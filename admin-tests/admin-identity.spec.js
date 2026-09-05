import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:4312";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${origin}/healthz`, { maxRedirects: 0 });
  expect(health.status()).toBe(204);
  expect(health.headers()["x-ores-chat-fixture"]).toBe(
    "synthetic-admin-identity-v1",
  );
  const ready = await request.get(`${origin}/readyz`, { maxRedirects: 0 });
  expect(ready.status()).toBe(503);
  expect(ready.headers()["x-ores-chat-fixture"]).toBe(
    "synthetic-admin-identity-v1",
  );
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    return route.abort("blockedbyclient");
  });
});

async function accessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("anonymous requests see the private sign-in boundary, not a chat or token form", async ({
  page,
}) => {
  const response = await page.goto("/admin");
  expect(response.status()).toBe(401);
  await expect(
    page.getByRole("heading", { name: "Administrator sign-in required" }),
  ).toBeVisible();
  await expect(page.locator("input, textarea")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Check access again" }),
  ).toBeVisible();
  await accessible(page);
});

test("verified identity renders a distinct restricted console without inventing product grants", async ({
  page,
}) => {
  const response = await page.goto("/fixture/verified");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["content-security-policy"]).toContain(
    "default-src 'none'",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "ores-admin-graphite-amber",
  );
  await expect(
    page.getByRole("heading", { name: "Identity verified" }),
  ).toBeVisible();
  await expect(
    page.getByText("LOOPBACK DEVELOPMENT · NOT A DEPLOYED ADMIN REALM"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "One gate at a time" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chat unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Administrator request", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Operational justification", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText(
    "No request sent · No context loaded · No audit event claimed",
  );
  const html = await page.content();
  for (const privateValue of [
    "synthetic-private-principal",
    "synthetic-private-session",
    "synthetic-never-render@example.test",
    "synthetic-admin-verified",
    "Audit recording enabled",
  ]) {
    expect(html).not.toContain(privateValue);
  }
  await expect(page.locator("script")).toHaveCount(0);
  await accessible(page);
});

for (const [mode, status, title] of [
  ["invalid", 401, "Administrator sign-in required"],
  ["stale", 403, "A fresh administrator session is required"],
  ["unavailable", 503, "We cannot verify administrator access"],
]) {
  test(`${mode} identity never opens the workspace or exposes upstream details`, async ({
    page,
  }) => {
    const response = await page.goto(`/fixture/${mode}`);
    expect(response.status()).toBe(status);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Identity verified" }),
    ).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    if (mode === "unavailable") {
      await expect(
        page.getByText(/existing session has not been cleared/),
      ).toBeVisible();
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    await accessible(page);
  });
}

test("direct native posts cannot claim an audit receipt or echo private input", async ({
  page,
}) => {
  await page.goto("/fixture/verified");
  const denied = await page.request.post(`${origin}/admin/chat`, {
    headers: { origin: "https://untrusted.example.test" },
    form: {
      message: "synthetic-private-input",
      justification: "synthetic incident",
    },
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(403);
  const unavailable = await page.request.post(`${origin}/admin/chat`, {
    headers: { origin },
    form: {
      message: "synthetic-private-input",
      justification: "synthetic incident",
    },
    maxRedirects: 0,
  });
  expect(unavailable.status()).toBe(503);
  const html = await unavailable.text();
  expect(html).toContain("not accepted for execution");
  expect(html).not.toContain("synthetic-private-input");
});

test("keyboard navigation works and neither credentials nor transcripts enter browser storage", async ({
  page,
}) => {
  await page.goto("/fixture/verified");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${origin}/admin#main`);
  await page.getByRole("link", { name: "Context policy", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Only what the task permits" }),
  ).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      cookie: document.cookie,
    })),
  ).toEqual({ local: [], session: [], cookie: "" });
  await accessible(page);
});
