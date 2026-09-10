package com.almadinaexpress.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** Approved pre-monorepo prices. Expected values are not generated. */
class PricingContractTest {
    private data class Tariff(val member: Membership, val zone: DeliveryZone, val delivery: Double, val returned: Double)
    private val cases = listOf(
        Tariff(Membership.STANDARD, DeliveryZone.WEST_BANK, 25.0, 20.0),
        Tariff(Membership.STANDARD, DeliveryZone.JERUSALEM, 35.0, 30.0),
        Tariff(Membership.STANDARD, DeliveryZone.INTERIOR, 80.0, 50.0),
        Tariff(Membership.PREMIUM, DeliveryZone.WEST_BANK, 20.0, 15.0),
        Tariff(Membership.PREMIUM, DeliveryZone.JERUSALEM, 30.0, 25.0),
        Tariff(Membership.PREMIUM, DeliveryZone.INTERIOR, 65.0, 40.0),
        Tariff(Membership.DIAMOND, DeliveryZone.WEST_BANK, 15.0, 10.0),
        Tariff(Membership.DIAMOND, DeliveryZone.JERUSALEM, 25.0, 15.0),
        Tariff(Membership.DIAMOND, DeliveryZone.INTERIOR, 55.0, 25.0),
    )

    @Test fun allDeliveryPricesPreserveTheApprovedTariff() {
        for (case in cases) assertEquals(case.delivery, baseDeliveryFee(case.member, case.zone), 0.0)
    }

    @Test fun allReturnPricesPreserveTheApprovedTariff() {
        for (case in cases) assertEquals(case.returned, returnDeliveryFee(case.member, case.zone), 0.0)
    }

    @Test fun generatedBaseFeeStillCombinesWithExistingWeightAndSizeRules() {
        val price = orderPricing(Membership.DIAMOND, DeliveryZone.INTERIOR, "5 - 10 كغم", 60.0, null, 50.0)
        assertEquals(55.0, price.baseFee, 0.0)
        assertEquals(5.0, price.weightFee, 0.0)
        assertEquals(14.0, price.oversizeFee, 0.0)
        assertEquals(74.0, price.deliveryFee, 0.0)
    }
}
