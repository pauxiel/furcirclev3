import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;

  const result = await docClient.send(new ScanCommand({
    TableName: table,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
    ExpressionAttributeValues: { ':prefix': 'VET#', ':sk': 'PROFILE' },
  }));

  const vets = (result.Items ?? []).map((v) => ({
    vetId: v['vetId'],
    firstName: v['firstName'],
    lastName: v['lastName'],
    email: v['email'],
    providerType: v['providerType'],
    specialisation: v['specialisation'],
    rating: v['rating'],
    reviewCount: v['reviewCount'],
    isActive: v['isActive'],
    createdAt: v['createdAt'],
  }));

  return success({ vets });
};
