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
  const platformAppArn = process.env['SNS_PLATFORM_APP_ARN'];

  const { Item: owner } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OWNER#${ownerId}`, SK: 'PROFILE' } }),
  );

  if (!owner || !owner['pushToken'] || !platformAppArn) {
    return { ...event };
  }

  const pushToken = owner['pushToken'] as string;

  // Create SNS endpoint (or use existing) and publish
  // For Expo push notifications, publish message directly with the token
  await sns.send(
    new PublishCommand({
      TargetArn: platformAppArn,
      Message: JSON.stringify({
        GCM: JSON.stringify({
          notification: {
            title: 'Plan ready!',
            body: `${name}'s monthly wellness plan is ready 🐾`,
          },
          data: { pushToken },
        }),
      }),
      MessageStructure: 'json',
    }),
  );

  return { ...event };
};
