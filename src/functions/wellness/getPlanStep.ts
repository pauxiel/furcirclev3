import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import type { PlanStep } from '../../lib/claude';

interface WhatToDoItem {
  stepId?: string;
  title: string;
  text: string;
  steps?: PlanStep[];
  videoTopic?: string;
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  const stepId = event.pathParameters?.['stepId'];
  if (!dogId || !stepId) return error('VALIDATION_ERROR', 'dogId and stepId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const month = new Date().toISOString().slice(0, 7);

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

  const plan = planResult.Item;
  if (!plan) return error('PLAN_NOT_FOUND', 'No plan for current month', 404);

  const whatToDo = (plan['whatToDo'] as WhatToDoItem[]) ?? [];
  const stepItem = whatToDo.find((item) => item.stepId === stepId);
  if (!stepItem) return error('STEP_NOT_FOUND', 'Step not found in current plan', 404);

  const activities = activitiesResult.Items ?? [];
  const completedTexts = new Set(
    activities.filter((a) => a['type'] === 'completed_task').map((a) => a['taskText'] as string),
  );

  return success({
    stepId: stepItem.stepId,
    title: stepItem.title,
    text: stepItem.text,
    completed: completedTexts.has(stepItem.text),
    steps: stepItem.steps ?? [],
    videoTopic: stepItem.videoTopic ?? null,
  });
};
