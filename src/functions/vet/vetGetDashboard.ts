import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const [assessmentsResult, bookingsResult, threadsResult] = await Promise.all([
    docClient.send(new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: { ':pk': `VET#${vetId}`, ':sk': 'ASSESSMENT#pending#' },
      Select: 'COUNT',
    })),
    docClient.send(new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: { ':pk': `VET#${vetId}`, ':sk': 'BOOKING#upcoming#' },
      Select: 'COUNT',
    })),
    docClient.send(new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: { ':pk': `VET#${vetId}`, ':sk': 'THREAD#open#' },
      Select: 'COUNT',
    })),
  ]);

  return success({
    pendingAssessments: assessmentsResult.Count ?? 0,
    upcomingBookings: bookingsResult.Count ?? 0,
    openThreads: threadsResult.Count ?? 0,
  });
};
