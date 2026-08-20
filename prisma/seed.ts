import { DEMO_SHOP } from "../app/lib/shop";
import { ensureShopSeeded } from "../app/lib/seed-demo.server";

await ensureShopSeeded(process.env.DEV_SHOP || DEMO_SHOP);
