import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';

interface SavePlanEvent {
  dogId: string;
  ownerId: string;
  name: string;
  breed: string;
  ageMonths: number;
  wellnessScore: number;
  [key: string]: unknown;
}

export const handler = async (event: SavePlanEvent): Promise<Record<string, unknown>> => {
  const { dogId, wellnessScore, ageMonths } = event;
  const table = process.env['TABLE_NAME']!;
  const now = new Date().toISOString();
  const month = now.slice(0, 7); // yyyy-mm

  await Promise.all([
    docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          ...event,
          PK: `DOG#${dogId}`,
          SK: `PLAN#${month}`,
          GSI1PK: `PLAN#${month}`,
          GSI1SK: `DOG#${dogId}`,
          month,
          ageMonthsAtPlan: ageMonths,
          generatedAt: now,
        },
      }),
    ),
    docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET planStatus = :status, wellnessScore = :score, updatedAt = :now',
        ExpressionAttributeValues: {
          ':status': 'ready',
          ':score': wellnessScore,
          ':now': now,
        },
      }),
    ),
  ]);

  return { ...event, planStatus: 'ready' };
};
