import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

// Two live provider types. `nutritionist` is coming-soon — its data is retained
// (records keep providerType:'nutritionist') but it is not surfaced as live, so
// it falls through to INVALID_TYPE. Re-add here to bring it back.
const VALID_TYPES = ['veterinarian', 'behaviourist'];

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const type = event.queryStringParameters?.['type'];

  if (!type || !VALID_TYPES.includes(type)) {
    return error('INVALID_TYPE', 'type must be veterinarian or behaviourist', 400);
  }

  const providersResult = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': `PROVIDER_TYPE#${type}` },
      ScanIndexForward: false,
    }),
  );

  const vets = providersResult.Items ?? [];

  // Veterinarians are reached through Ask-a-Vet messaging, not bookings, so
  // they carry no subscription/assessment/canBook coupling — return the plain
  // rating-sorted list (already sorted by the GSI3 query).
  if (type === 'veterinarian') {
    const providers = vets.map((vet) => ({
      vetId: vet['vetId'],
      firstName: vet['firstName'],
      lastName: vet['lastName'],
      providerType: vet['providerType'],
      specialisation: vet['specialisation'] ?? null,
      photoUrl: vet['photoUrl'] ?? null,
      rating: vet['rating'],
      reviewCount: vet['reviewCount'],
      isActive: vet['isActive'],
    }));
    return success({ providers });
  }

  if (vets.length === 0) {
    return success({ providers: [] });
  }

  const [subscriptionResult, ...assessmentResults] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } }),
    ),
    ...vets.map((vet) =>
      docClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
          ExpressionAttributeValues: {
            ':pk': `OWNER#${userId}`,
            ':sk': `ASSESSMENT#${vet['vetId'] as string}`,
          },
          Limit: 1,
        }),
      ),
    ),
  ]);

  const plan = ((subscriptionResult as { Item?: Record<string, unknown> }).Item?.['plan'] as string) ?? null;

  const providers = vets.map((vet, idx) => {
    const assessmentItems = (assessmentResults[idx] as { Items?: Record<string, unknown>[] }).Items ?? [];
    const assessment = assessmentItems[0];
    const assessmentStatus = assessment ? (assessment['status'] as string) : 'none';

    let canBook = false;
    if (plan === 'proactive') {
      canBook = type === 'nutritionist' ? true : assessmentStatus === 'approved';
    }

    return {
      vetId: vet['vetId'],
      firstName: vet['firstName'],
      lastName: vet['lastName'],
      providerType: vet['providerType'],
      specialisation: vet['specialisation'] ?? null,
      photoUrl: vet['photoUrl'] ?? null,
      rating: vet['rating'],
      reviewCount: vet['reviewCount'],
      isActive: vet['isActive'],
      assessmentStatus,
      canBook,
    };
  });

  return success({ providers });
};
