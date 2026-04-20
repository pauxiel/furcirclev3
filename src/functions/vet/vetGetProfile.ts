import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } }),
  );

  const profile = result.Item;
  if (!profile) return error('VET_NOT_FOUND', 'Vet profile not found', 404);

  return success({
    vetId: profile['vetId'],
    firstName: profile['firstName'],
    lastName: profile['lastName'],
    email: profile['email'],
    providerType: profile['providerType'],
    specialisation: profile['specialisation'] ?? null,
    bio: profile['bio'] ?? null,
    photoUrl: profile['photoUrl'] ?? null,
    rating: profile['rating'] ?? null,
    reviewCount: profile['reviewCount'] ?? 0,
    isActive: profile['isActive'] ?? true,
    createdAt: profile['createdAt'],
  });
};
