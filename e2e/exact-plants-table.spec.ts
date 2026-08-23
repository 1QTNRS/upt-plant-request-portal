import { expect, test } from "@playwright/test";

test.describe("EXACT PLANTS table", () => {
  test("sortable headers keep the listing filter and open the photo viewer", async ({
    page,
  }) => {
    await page.goto("/app/exact-plants");
    await expect(page.getByText("EXACT PLANTS queue")).toBeVisible();

    const table = page.locator("[data-exact-plants-table]");
    await expect(table).toBeVisible();
    await expect(page.getByText("Thai Constellation")).toBeVisible();
    await expect(page.getByText("Calathea")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("lisa.park@email.com");
    await expect(page.locator("body")).not.toContainText("alex.rivera@example.com");

    await page.locator("[data-exact-plant-sort='name']").click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page).toHaveURL(/dir=asc/);
    const namesAsc = await page.locator("[data-exact-plant-row] strong").allTextContents();
    const sortedAsc = [...namesAsc].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
    expect(namesAsc).toEqual(sortedAsc);

    await page.locator("[data-exact-plant-sort='name']").click();
    await expect(page).toHaveURL(/dir=desc/);

    await page.locator("[data-exact-plant-sort='request']").click();
    await expect(page).toHaveURL(/sort=request/);
    await expect(page).toHaveURL(/dir=asc/);

    await page.locator("[data-exact-plant-sort='price']").click();
    await expect(page).toHaveURL(/sort=price/);

    await page.locator("[data-exact-plant-sort='date']").click();
    await expect(page).toHaveURL(/sort=date/);

    await page.getByRole("button", { name: /Not Yet Listed/ }).click();
    await expect(page).toHaveURL(/listing=not_yet_listed/);
    await expect(page).toHaveURL(/sort=date/);

    await page.getByRole("button", { name: /^All / }).click();
    await expect(page).toHaveURL(/sort=date/);

    await page.locator("summary", { hasText: "EXACT PLANTS queue" }).click();
    await expect(table).toBeHidden();
    await page.locator("summary", { hasText: "EXACT PLANTS queue" }).click();
    await expect(table).toBeVisible();
    await expect(page).toHaveURL(/sort=date/);

    const photo = page.locator("[data-exact-plant-photo]").first();
    await photo.click();
    const lightbox = page.locator("[data-admin-photo-lightbox]");
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Close" })).toBeVisible();
    if (await page.locator("[data-lightbox-next]").count()) {
      const before = await page.locator("[data-lightbox-status]").textContent();
      await page.locator("[data-lightbox-next]").click();
      await expect(page.locator("[data-lightbox-status]")).not.toHaveText(before ?? "");
      await page.locator("[data-lightbox-prev]").click();
      await expect(page.locator("[data-lightbox-status]")).toHaveText(before ?? "");
    }
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);

    const requestLink = page.getByRole("link", { name: /Request REQ/ }).first();
    await expect(requestLink).toHaveAttribute("href", /\/app\/requests\//);
    await requestLink.click();
    await expect(page).toHaveURL(/\/app\/requests\//);
    await expect(page.getByText("EXACT PLANTS")).toBeVisible();
  });

  test("actions still offer listing and dismiss", async ({ page }) => {
    await page.goto("/app/exact-plants");
    await expect(
      page.getByRole("link", { name: "Create EXACT PLANTS Listing" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dismiss from EXACT PLANTS" }).first(),
    ).toBeVisible();
  });
});
