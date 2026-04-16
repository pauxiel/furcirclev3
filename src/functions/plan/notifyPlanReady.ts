import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient } from '../../lib/dynamodb';

const sns = new SNSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

interface NotifyPlanReadyEvent {
  dogId: string;
  ownerId: string;
  name: string;
  planStatus: string;
  wellnessScore?: number;
  [key: string]: unknown;
}

export const handler = async (event: NotifyPlanReadyEvent): Promise<Record<string, unknown>> => {
  const { ownerId, name } = event;
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN'];

  const { Item: owner } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OWNER#${ownerId}`, SK: 'PROFILE' } }),
  );

  if (!owner || !topicArn) {
    return { ...event };
  }

  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: 'plan_ready',
      Message: JSON.stringify({
        ownerId,
        dogId: event.dogId,
        dogName: name,
        pushToken: owner['pushToken'] ?? null,
        message: `${name}'s monthly wellness plan is ready 🐾`,
      }),
    }),
  );

  return { ...event };
};
