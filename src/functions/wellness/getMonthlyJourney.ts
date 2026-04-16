import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import type { CategoryScores } from '../../lib/wellness';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const month = event.queryStringParameters?.['month'] ?? new Date().toISOString().slice(0, 7);

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );
  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const { Item: plan } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: `PLAN#${month}` } }),
  );

  if (!plan) {
    if (dog['planStatus'] === 'generating') {
      return success({ planStatus: 'generating' });
    }
    return error('PLAN_NOT_FOUND', 'Plan not found for this month', 404);
  }

  const { Items: activityItems = [] } = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `DOG#${dogId}`,
        ':prefix': `ACTIVITY#${month}`,
      },
    }),
  );

  const completedTexts = new Set(
    activityItems
      .filter((a) => a['type'] === 'completed_task')
      .map((a) => a['taskText'] as string),
  );

  const whatToDo = (plan['whatToDo'] as Array<{ text: string; videoTopic: string | null }> ?? []).map(
    (item) => ({ ...item, completed: completedTexts.has(item.text) }),
  );

  const completedCount = completedTexts.size;
  const totalTasks = whatToDo.length;
  const monthLabel = `Month ${plan['ageMonthsAtPlan'] as number} with ${dog['name'] as string}`;

  return success({
    month,
    dogId,
    monthLabel,
    planStatus: dog['planStatus'],
    wellnessScore: dog['wellnessScore'],
    categoryScores: dog['categoryScores'] as CategoryScores,
    completedCount,
    totalTasks,
    whatToDo,
    whatNotToDo: plan['whatNotToDo'],
    watchFor: plan['watchFor'],
    earlyWarningSigns: plan['earlyWarningSigns'],
  });
};
