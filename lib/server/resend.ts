import 'server-only';

import { inspectDemoEmailRecipients } from '@/lib/utils/demo-email';

export interface ResendEmailPayload {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: unknown[];
}

export interface SendResendEmailOptions {
  apiKey: string;
  payload: ResendEmailPayload;
}

export async function sendResendEmail({ apiKey, payload }: SendResendEmailOptions): Promise<Response> {
  const demoCheck = inspectDemoEmailRecipients(payload.to);

  if (demoCheck.shouldSimulate) {
    console.info(
      `Demo email simulated for ${demoCheck.demoRecipients.join(', ')}. No message was sent to ${demoCheck.demoDomain}.`
    );

    return Response.json({
      id: `demo-simulated-${Date.now()}`,
      simulated: true,
      demoRecipients: demoCheck.demoRecipients,
      realRecipients: demoCheck.realRecipients,
    });
  }

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
