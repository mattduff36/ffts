import 'server-only';

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
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
