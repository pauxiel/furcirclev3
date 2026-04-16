import { ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient } from '../../lib/dynamodb';

const sns = new SNSClient({});

export const handler = async (_event: unknown): Promise<void> => {
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['NOTIFICATIONS_TOPIC_ARN']!;
  const now = new Date().toISOString();

  let totalClosed = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: '#type = :type AND #status = :status AND closedAt <= :now',
        ExpressionAttributeNames: {
          '#type': 'type',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':type': 'post_booking',
          ':status': 'open',
          ':now': now,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    const expired = result.Items ?? [];

    await Promise.allSettled(
      expired.map(async (thread) => {
        const threadId = thread['threadId'] as string;
        const ownerId = thread['ownerId'] as string;

        await docClient.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' },
            UpdateExpression: 'SET #status = :closed',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':closed': 'closed' },
          }),
        );

        try {
          const { Item: owner } = await docClient.send(
            new GetCommand({ TableName: table, Key: { PK: `OWNER#${ownerId}`, SK: 'PROFILE' } }),
          );
          if (owner?.['pushToken']) {
            await sns.send(
              new PublishCommand({
                TopicArn: topicArn,
                Message: JSON.stringify({
                  type: 'THREAD_CLOSED',
                  threadId,
                  pushToken: owner['pushToken'],
                }),
              }),
            );
          }
        } catch (err) {
          console.error('SNS notify failed (non-fatal):', err);
        }

        totalClosed++;
      }),
    );

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`closeExpiredThreads: closed ${totalClosed} threads`);
};
