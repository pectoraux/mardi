// Bootstrap EmailProvider — logs emails in SIMULATION mode.
// Production: SendGrid/Resend/SES adapter behind the same interface.

import type { EmailProviderPort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { randomUUID } from 'node:crypto'

export const LoggingEmailProvider: EmailProviderPort = {
  async send(ctx, email) {
    void ctx
    // In bootstrap mode, log the email but don't actually send.
    // Production: SendGrid/Resend adapter would call the API.
    console.log('[email] SIMULATION mode — not sending:', {
      to: email.to,
      subject: email.subject,
      bodyPreview: email.body.slice(0, 100),
    })
    return {
      messageId: randomUUID(),
      provider: 'logging',
      mode: 'SIMULATION',
    }
  },
}
