import type { SNSEvent } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { sendEmail } from '../../lib/email';
import { listActiveVeterinarians } from '../../lib/providers';

type EmailPayload = Record<string, unknown>;

interface ResolvedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function resolveBehaviouristIntake(
  payload: EmailPayload,
  table: string,
): Promise<ResolvedEmail | null> {
  const ownerId = payload['ownerId'] as string;
  const vetId = payload['vetId'] as string;
  const dogId = payload['dogId'] as string;
  const description = (payload['description'] as string) ?? '';
  const mediaUrls = (payload['mediaUrls'] as string[]) ?? [];

  const [ownerRes, dogRes, vetRes] = await Promise.all([
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${ownerId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } })),
  ]);

  const owner = ownerRes.Item;
  const dog = dogRes.Item;
  const vet = vetRes.Item;

  const to = vet?.['email'] as string | undefined;
  if (!to) return null; // no recipient — nothing to send

  const ownerName = `${owner?.['firstName'] ?? ''} ${owner?.['lastName'] ?? ''}`.trim() || 'A FurCircle owner';
  const ownerEmail = (owner?.['email'] as string) ?? 'unknown';
  const dogName = (dog?.['name'] as string) ?? 'their dog';
  const dogBreed = (dog?.['breed'] as string) ?? '';

  const mediaText = mediaUrls.length ? `\nAttachments:\n${mediaUrls.join('\n')}` : '';
  const mediaHtml = mediaUrls.length
    ? `<p><strong>Attachments:</strong><br>${mediaUrls.map((u) => `<a href="${esc(u)}">${esc(u)}</a>`).join('<br>')}</p>`
    : '';

  const text = [
    `New behaviour request from ${ownerName}.`,
    '',
    `Owner: ${ownerName}`,
    `Owner email: ${ownerEmail}`,
    `Dog: ${dogName}${dogBreed ? ` (${dogBreed})` : ''}`,
    '',
    'Concern:',
    description,
    mediaText,
    '',
    'Reply to the owner directly to follow up.',
  ].join('\n');

  const html = [
    `<p>New behaviour request from <strong>${esc(ownerName)}</strong>.</p>`,
    `<p><strong>Owner:</strong> ${esc(ownerName)}<br>`,
    `<strong>Owner email:</strong> <a href="mailto:${esc(ownerEmail)}">${esc(ownerEmail)}</a><br>`,
    `<strong>Dog:</strong> ${esc(dogName)}${dogBreed ? ` (${esc(dogBreed)})` : ''}</p>`,
    `<p><strong>Concern:</strong><br>${esc(description)}</p>`,
    mediaHtml,
    `<p>Reply to the owner directly to follow up.</p>`,
  ].join('');

  return { to, subject: `New behaviour request from ${ownerName}`, html, text };
}

/**
 * Resolve an SNS notification into a provider-facing email, or null to skip.
 *   - S1: `behaviourist_intake`
 *   - S3: `question_broadcast` (todo)
 */
async function resolveEmail(
  subject: string,
  payload: EmailPayload,
  table: string,
): Promise<ResolvedEmail | null> {
  switch (subject) {
    case 'behaviourist_intake':
      return resolveBehaviouristIntake(payload, table);
    default:
      return null;
  }
}

async function broadcastQuestionToVets(payload: EmailPayload, table: string): Promise<void> {
  const dogName = (payload['dogName'] as string) ?? 'a dog';
  const vets = await listActiveVeterinarians(table);
  const subject = `New Ask-a-Vet question about ${dogName}`;
  const text = `A FurCircle owner has asked a question about ${dogName}. Open the FurCircle vet app to read and answer it — the first vet to reply takes the case.`;
  const html = `<p>A FurCircle owner has asked a question about <strong>${esc(dogName)}</strong>.</p><p>Open the FurCircle vet app to read and answer it — the first vet to reply takes the case.</p>`;

  await Promise.all(
    vets
      .filter((v) => v.email)
      .map((v) =>
        sendEmail({ to: v.email as string, subject, html, text }).catch((err) =>
          console.error(`Broadcast email failed for vet=${v.vetId}:`, err),
        ),
      ),
  );
}

export const handler = async (event: SNSEvent): Promise<void> => {
  const table = process.env['TABLE_NAME']!;

  for (const record of event.Records) {
    const subject = record.Sns.Subject ?? '';
    const payload = JSON.parse(record.Sns.Message) as EmailPayload;

    try {
      // Ask-a-Vet broadcast is a fan-out (many recipients), handled separately
      // from the single-recipient resolveEmail path.
      if (subject === 'question_broadcast') {
        await broadcastQuestionToVets(payload, table);
        continue;
      }

      const email = await resolveEmail(subject, payload, table);
      if (!email) continue;
      await sendEmail(email);
    } catch (err) {
      console.error(`Provider email failed for subject=${subject}:`, err);
    }
  }
};

export { resolveEmail };
