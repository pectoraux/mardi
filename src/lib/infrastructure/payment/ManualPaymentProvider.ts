// Bootstrap PaymentProvider — manual verification only.
// Production: Stripe adapter behind the same interface (requires STRIPE_SECRET_KEY).

import type { PaymentProviderPort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'

export const ManualPaymentProvider: PaymentProviderPort = {
  async verifyPayment(ctx, paymentReference, provider) {
    void ctx
    // In bootstrap mode, we cannot verify payments against a real API.
    // This returns UNVERIFIED — the caller must use the verificationLevel
    // logic in CapitalProvenanceService to determine if it counts.
    // Production Stripe adapter would call stripe.paymentIntents.retrieve().
    return {
      verified: false,
      amount: 0,
      currency: 'USD',
      paidAt: new Date(),
      fees: 0,
      metadata: { paymentReference, provider, note: 'manual verification — not API-verified' },
    }
  },

  async createPayment(ctx, input) {
    void ctx
    // In bootstrap mode, return a manual reference.
    // Production would create a Stripe Checkout Session / PaymentIntent.
    return {
      paymentReference: `manual_${Date.now()}`,
      checkoutUrl: undefined,
    }
  },
}
