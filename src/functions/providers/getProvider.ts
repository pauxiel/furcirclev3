import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const vetId = event.pathParameters?.['vetId'];

  if (!vetId) {
    return error('INVALID_REQUEST', 'vetId is required', 400);
  }

  const today = new Date().toISOString().substring(0, 10);

  const [vetResult, subscriptionResult, assessmentResult, availResult] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } }),
    ),
    docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `OWNER#${userId}`,
          ':sk': `ASSESSMENT#${vetId}`,
        },
        Limit: 1,
      }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': `VET#${vetId}`,
          ':start': `AVAIL#${today}`,
          ':end': 'AVAIL#9999-99-99',
        },
        ScanIndexForward: true,
        Limit: 1,
      }),
    ),
  ]);

  const vet = (vetResult as { Item?: Record<string, unknown> }).Item;
  if (!vet) {
    return error('NOT_FOUND', 'Provider not found', 404);
  }

  const plan = ((subscriptionResult as { Item?: Record<string, unknown> }).Item?.['plan'] as string) ?? null;
  const assessmentItems = (assessmentResult as { Items?: Record<string, unknown>[] }).Items ?? [];
  const assessment = assessmentItems[0];
  const assessmentStatus = assessment ? (assessment['status'] as string) : 'none';

  let canBook = false;
  if (plan === 'proactive') {
    canBook = vet['providerType'] === 'nutritionist' ? true : assessmentStatus === 'approved';
  }

  const availItems = (availResult as { Items?: Record<string, unknown>[] }).Items ?? [];
  const nextAvailable = availItems[0] ? (availItems[0]['date'] as string) : null;

  return success({
    vetId: vet['vetId'],
    firstName: vet['firstName'],
    lastName: vet['lastName'],
    providerType: vet['providerType'],
    specialisation: vet['specialisation'] ?? null,
    bio: vet['bio'] ?? null,
    photoUrl: vet['photoUrl'] ?? null,
    rating: vet['rating'],
    reviewCount: vet['reviewCount'],
    isActive: vet['isActive'],
    assessmentStatus,
    canBook,
    availability: { nextAvailable },
  });
};
