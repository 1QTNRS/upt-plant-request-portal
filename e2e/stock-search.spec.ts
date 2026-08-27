import { expect, test } from "@playwright/test";

test.describe("Link Stock search", () => {
  test("shows variant inventory and keeps no-stock rows unselectable", async ({
    page,
  }) => {
    await page.goto("/app?q=Sarah+Mitchell");
    await expect(page.getByText("Sarah Mitchell").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator(".upt-wide-only").getByText("View items").click();
    await expect(page.getByText("Monstera Deliciosa", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const search = page.locator("input[placeholder='Product title, variant, or SKU']");
    await expect(async () => {
      if (!(await search.isVisible())) {
        await page.getByText("Link Existing Website Stock").first().click();
      }
      await expect(search).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    await search.fill("thai");
    const dropdown = page.locator("[data-stock-search-dropdown]");
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText("Monstera Thai Constellation")).toBeVisible({
      timeout: 10_000,
    });
    await expect(dropdown.getByText("6 inch")).toBeVisible();
    await expect(dropdown.locator("[data-stock-search-inventory]").first()).toHaveText(
      "4 in stock",
    );
    await expect(dropdown.locator("[data-stock-search-option]")).toHaveCount(1);
    const inStockBox = await dropdown.boundingBox();
    expect(inStockBox?.height ?? 999).toBeLessThan(300);

    await search.fill("anthurium");
    await expect(dropdown.getByText("Anthurium Warocqueanum")).toBeVisible({
      timeout: 10_000,
    });
    await expect(dropdown.locator("[data-stock-search-no-stock]")).toHaveText("No stock");
    await expect(dropdown.locator("[data-stock-search-no-stock]")).toHaveCSS(
      "color",
      "rgb(142, 31, 11)",
    );
    await expect(dropdown.locator("[data-stock-search-option]")).toHaveCount(0);

    await search.fill("draft");
    await expect(dropdown.getByText("No Shopify products match")).toBeVisible({
      timeout: 10_000,
    });
    await expect(dropdown.getByText("Alocasia Dragon Scale")).toHaveCount(0);

    await search.fill("hoya");
    await expect(dropdown.getByText("No Shopify products match")).toBeVisible({
      timeout: 10_000,
    });
    await expect(dropdown.getByText("Hoya Compacta")).toHaveCount(0);
  });
});
