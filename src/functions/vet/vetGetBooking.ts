import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const bookingId = event.pathParameters?.['bookingId'];

  if (!bookingId) return error('INVALID_REQUEST', 'bookingId is required', 400);

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' } }),
  );

  const booking = result.Item;
  if (!booking) return error('NOT_FOUND', 'Booking not found', 404);
  if (booking['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);

  const keys: { PK: string; SK: string }[] = [
    { PK: `OWNER#${booking['ownerId']}`, SK: 'PROFILE' },
    { PK: `DOG#${booking['dogId']}`, SK: 'PROFILE' },
  ];
  if (booking['assessmentId']) {
    keys.push({ PK: `ASSESSMENT#${booking['assessmentId']}`, SK: 'ASSESSMENT' });
  }

  const batchResult = await docClient.send(
    new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }),
  );

  const profiles = batchResult.Responses?.[table] ?? [];
  const owner = profiles.find((p) => (p['PK'] as string).startsWith('OWNER#'));
  const dog = profiles.find((p) => (p['PK'] as string).startsWith('DOG#'));
  const assessment = profiles.find((p) => (p['PK'] as string).startsWith('ASSESSMENT#'));

  return success({
    bookingId: booking['bookingId'],
    owner: owner
      ? { userId: owner['userId'], firstName: owner['firstName'], lastName: owner['lastName'], email: owner['email'] }
      : null,
    dog: dog
      ? {
          dogId: dog['dogId'],
          name: dog['name'],
          breed: dog['breed'],
          ageMonths: dog['ageMonths'],
          spayedNeutered: dog['spayedNeutered'] ?? null,
          medicalConditions: dog['medicalConditions'] ?? null,
          wellnessScore: dog['wellnessScore'] ?? null,
        }
      : null,
    assessment: assessment
      ? { assessmentId: assessment['assessmentId'], description: assessment['description'], vetResponse: assessment['vetResponse'] ?? null }
      : null,
    duration: booking['duration'],
    scheduledAt: booking['scheduledAt'],
    status: booking['status'],
    agoraChannelId: booking['agoraChannelId'],
    postCallSummary: booking['postCallSummary'] ?? null,
    createdAt: booking['createdAt'],
  });
};
