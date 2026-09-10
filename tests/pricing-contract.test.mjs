import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDeliveryFee, getReturnFee, governorates } from "../apps/web/app/lib/data.ts";

// Approved pre-migration tariff fixture; deliberately NOT generated from pricing.json.
const cases = [
  ["standard", "westBank", "الخليل", 25, 20],
  ["standard", "jerusalem", "القدس", 35, 30],
  ["standard", "interior", "الداخل", 80, 50],
  ["premium", "westBank", "الخليل", 20, 15],
  ["premium", "jerusalem", "القدس", 30, 25],
  ["premium", "interior", "الداخل", 65, 40],
  ["diamond", "westBank", "الخليل", 15, 10],
  ["diamond", "jerusalem", "القدس", 25, 15],
  ["diamond", "interior", "الداخل", 55, 25],
];

test("all 18 shared tariffs and actual web functions preserve the approved prices", async () => {
  const shared = JSON.parse(await readFile(new URL("../shared/pricing.json", import.meta.url), "utf8"));
  for (const [membership, zone, name, delivery, returned] of cases) {
    assert.equal(shared.deliveryPricing[membership][zone], delivery);
    assert.equal(shared.returnPricing[membership][zone], returned);
    assert.equal(getDeliveryFee({ name }, membership), delivery);
    assert.equal(getReturnFee({ name }, membership), returned);
  }
});

test("the catalog defaults agree with standard delivery; missing location stays zero", () => {
  for (const region of governorates) assert.equal(region.fee, getDeliveryFee(region, "standard"));
  assert.equal(getDeliveryFee(undefined, "standard"), 0);
  assert.equal(getReturnFee(undefined, "standard"), 0);
});
