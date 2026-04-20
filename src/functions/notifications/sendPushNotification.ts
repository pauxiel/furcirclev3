import type { SNSEvent } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { sendPush } from '../../lib/push';

const TITLE = 'FurCircle';

type NotifPayload = Record<string, unknown>;

function buildMessage(subject: string, payload: NotifPayload): { body: string; data: Record<string, unknown> } | null {
  switch (subject) {
    case 'plan_ready':
      return {
        body: `${payload['dogName']}'s monthly wellness plan is ready 🐾`,
        data: { type: 'plan_ready', dogId: payload['dogId'] },
      };
    case 'new_vet_message':
      return {
        body: 'You have a new message from your vet',
        data: { type: 'new_vet_message', threadId: payload['threadId'] },
      };
    case 'new_owner_message':
      return {
        body: 'Your vet received your message',
        data: { type: 'new_owner_message', threadId: payload['threadId'] },
      };
    case 'thread_closed':
      return {
        body: 'Your consultation thread has been closed',
        data: { type: 'thread_closed', threadId: payload['threadId'] },
      };
    case 'assessment_responded': {
      const decision = payload['decision'] as string;
      return {
        body: `Your assessment has been ${decision} by the vet`,
        data: { type: 'assessment_responded', assessmentId: payload['assessmentId'], decision },
      };
    }
    case 'new_booking':
      return {
        body: 'Your consultation booking is confirmed ✅',
        data: { type: 'new_booking', bookingId: payload['bookingId'] },
      };
    case 'booking_cancelled':
      return {
        body: 'Your booking has been cancelled',
        data: { type: 'booking_cancelled', bookingId: payload['bookingId'] },
      };
    default:
      return null;
  }
}

export const handler = async (event: SNSEvent): Promise<void> => {
  const table = process.env['TABLE_NAME']!;

  for (const record of event.Records) {
    const subject = record.Sns.Subject ?? '';
    const payload = JSON.parse(record.Sns.Message) as NotifPayload;
    const ownerId = payload['ownerId'] as string | undefined;

    const message = buildMessage(subject, payload);
    if (!message || !ownerId) continue;

    try {
      const { Item: owner } = await docClient.send(
        new GetCommand({ TableName: table, Key: { PK: `OWNER#${ownerId}`, SK: 'PROFILE' } }),
      );

      const pushToken = owner?.['pushToken'] as string | null;
      if (!pushToken) continue;

      await sendPush({ to: pushToken, title: TITLE, ...message });
    } catch (err) {
      console.error(`Push failed for subject=${subject} ownerId=${ownerId}:`, err);
    }
  }
};
