import assert from "node:assert/strict";
import test from "node:test";
import { getDeliveryFee, getReturnFee, governorates } from "../app/lib/data.ts";

// Approved company tariff fixture; independent of the implementation.
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

test("all 18 actual web tariffs preserve the approved prices", () => {
  for (const [membership, zone, name, delivery, returned] of cases) {
    assert.equal(getDeliveryFee({ name }, membership), delivery);
    assert.equal(getReturnFee({ name }, membership), returned);
  }
});

test("the catalog defaults agree with standard delivery; missing location stays zero", () => {
  for (const region of governorates) assert.equal(region.fee, getDeliveryFee(region, "standard"));
  assert.equal(getDeliveryFee(undefined, "standard"), 0);
  assert.equal(getReturnFee(undefined, "standard"), 0);
});
