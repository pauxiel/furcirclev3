import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const from = process.env['FROM_EMAIL'];
  if (!from) throw new Error('FROM_EMAIL not configured');

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: {
            Html: { Data: message.html },
            Text: { Data: message.text },
          },
        },
      },
    }),
  );
}
