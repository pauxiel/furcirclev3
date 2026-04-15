import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';

interface HandlePlanErrorEvent {
  dogId: string;
  error?: string;
  [key: string]: unknown;
}

export const handler = async (event: HandlePlanErrorEvent): Promise<Record<string, unknown>> => {
  const { dogId } = event;
  const table = process.env['TABLE_NAME']!;
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' },
      UpdateExpression: 'SET planStatus = :status, updatedAt = :now',
      ExpressionAttributeValues: { ':status': 'failed', ':now': now },
    }),
  );

  return { ...event, planStatus: 'failed' };
};
