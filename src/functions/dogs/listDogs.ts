import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Items: dogs = [] } = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :owner AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':owner': `OWNER#${userId}`,
        ':prefix': 'DOG#',
      },
    }),
  );

  return success({
    dogs: dogs.map((d) => ({
      dogId: d['dogId'],
      name: d['name'],
      breed: d['breed'],
      ageMonths: d['ageMonths'],
      planStatus: d['planStatus'],
      wellnessScore: d['wellnessScore'] ?? null,
      createdAt: d['createdAt'],
    })),
  });
};
