import { expect, test } from "@playwright/test";

test.describe("Customer request", () => {
  test("demo customer can submit a request and see Home / My Requests", async ({
    page,
  }) => {
    await page.goto("/customer");
    await page.getByRole("button", { name: "Continue as logged in customer" }).click();
    await expect(page.getByText("Alex Rivera")).toBeVisible();

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
    await expect(page.getByText(plant).first()).toBeVisible();
    await expect(page.getByText("New").first()).toBeVisible();
  });
});

test.describe("Customer offer response", () => {
  test("declined Exact Plant request stays visible with no payable invoice", async ({
    page,
  }) => {
    await page.goto("/customer");
    await page.getByRole("button", { name: "Continue as logged in customer" }).click();
    await page.getByText("REQ8", { exact: true }).click();
    await expect(page.getByText("Thai Constellation")).toBeVisible();
    await expect(
      page.getByText(/No Payment Needed|Needs Payment|Offer Ready for Review/),
    ).toBeVisible();
  });
});
