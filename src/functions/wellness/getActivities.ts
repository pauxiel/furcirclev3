import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const month = (event.queryStringParameters?.['month']) ?? new Date().toISOString().slice(0, 7);

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );
  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const [planResult, activitiesResult] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: `PLAN#${month}` } }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `DOG#${dogId}`,
          ':prefix': `ACTIVITY#${month}`,
        },
      }),
    ),
  ]);

  const totalTasks = (planResult.Item?.['whatToDo'] as unknown[] | undefined)?.length ?? 0;
  const activities = activitiesResult.Items ?? [];
  const completedCount = activities.filter((a) => a['type'] === 'completed_task').length;

  return success({
    month,
    dogId,
    activities: activities.map((a) => ({
      activityId: a['activityId'],
      type: a['type'],
      taskText: a['taskText'],
      category: a['category'],
      createdAt: a['createdAt'],
    })),
    completedCount,
    totalTasks,
  });
};
