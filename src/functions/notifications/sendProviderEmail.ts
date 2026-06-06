import type { SNSEvent } from 'aws-lambda';
import { sendEmail } from '../../lib/email';

type EmailPayload = Record<string, unknown>;

interface ResolvedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Resolve an SNS notification into a provider-facing email, or null to skip.
 * Cases are added per slice:
 *   - S1: `behaviourist_intake`
 *   - S3: `question_broadcast`
 */
async function resolveEmail(
  subject: string,
  _payload: EmailPayload,
  _table: string,
): Promise<ResolvedEmail | null> {
  switch (subject) {
    default:
      return null;
  }
}

export const handler = async (event: SNSEvent): Promise<void> => {
  const table = process.env['TABLE_NAME']!;

  for (const record of event.Records) {
    const subject = record.Sns.Subject ?? '';
    const payload = JSON.parse(record.Sns.Message) as EmailPayload;

    try {
      const email = await resolveEmail(subject, payload, table);
      if (!email) continue;
      await sendEmail(email);
    } catch (err) {
      console.error(`Provider email failed for subject=${subject}:`, err);
    }
  }
};

export { resolveEmail };
