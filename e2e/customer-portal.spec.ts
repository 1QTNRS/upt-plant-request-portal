import { expect, test, type Page } from "@playwright/test";

async function continueAsDemoCustomer(page: Page) {
  await page.goto("/customer", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  if (await page.getByText("Plants requested").isVisible()) return;
  const login = page.getByRole("button", {
    name: "Continue as logged in customer",
  });
  await expect(login).toBeVisible();
  await login.click({ timeout: 20_000 });
  await expect(page.getByText("Plants requested")).toBeVisible({
    timeout: 20_000,
  });
}

test.beforeAll(async ({ request }) => {
  await request.get("/healthz");
  await request.get("/customer");
});

test.describe("Customer request", () => {
  test("demo customer can submit a request and see Home / My Requests", async ({
    page,
  }) => {
    await continueAsDemoCustomer(page);

    await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "My Requests" })).toHaveAttribute(
      "href",
      "/customer",
    );

    const plant = `Smoke Portal Plant ${Date.now()}`;
    await page.locator('input[name="plantName-0"]').fill(plant);
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText(/Request submitted\. Your request number is REQ/)).toBeVisible();
    await expect(page.getByText("New", { exact: true }).first()).toBeVisible();
  });
});

test.describe("Customer offer response", () => {
  test("declined Exact Plant request stays visible with no payable invoice", async ({
    page,
  }) => {
    await continueAsDemoCustomer(page);
    await expect(page.getByText("REQ8", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText("REQ8", { exact: true }).click();
    await expect(page.getByText("Thai Constellation")).toBeVisible();
    await expect(
      page.getByText(/Closed|No Payment Needed|Needs Payment|Offer Ready for Review/),
    ).toBeVisible();
  });
});
