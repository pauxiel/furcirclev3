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
  const assessmentId = event.pathParameters?.['assessmentId'];

  if (!assessmentId) return error('INVALID_REQUEST', 'assessmentId is required', 400);

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `ASSESSMENT#${assessmentId}`, SK: 'ASSESSMENT' } }),
  );

  const assessment = result.Item;
  if (!assessment) return error('NOT_FOUND', 'Assessment not found', 404);
  if (assessment['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);

  const batchResult = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: [
            { PK: `OWNER#${assessment['ownerId']}`, SK: 'PROFILE' },
            { PK: `DOG#${assessment['dogId']}`, SK: 'PROFILE' },
          ],
        },
      },
    }),
  );

  const profiles = batchResult.Responses?.[table] ?? [];
  const owner = profiles.find((p) => (p['PK'] as string).startsWith('OWNER#'));
  const dog = profiles.find((p) => (p['PK'] as string).startsWith('DOG#'));

  return success({
    assessmentId: assessment['assessmentId'],
    owner: owner
      ? {
          userId: owner['userId'],
          firstName: owner['firstName'],
          lastName: owner['lastName'],
          email: owner['email'],
        }
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
    description: assessment['description'],
    mediaUrls: assessment['mediaUrls'] ?? [],
    status: assessment['status'],
    vetResponse: assessment['vetResponse'] ?? null,
    reviewedAt: assessment['reviewedAt'] ?? null,
    createdAt: assessment['createdAt'],
  });
};
