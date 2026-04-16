import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import {
  assignCategory,
  recalcScore,
  computeWellnessScore,
  DEFAULT_CATEGORY_SCORES,
  type ActivityType,
  type CategoryScores,
} from '../../lib/wellness';

const VALID_TYPES: ActivityType[] = ['completed_task', 'skipped_task'];

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { type, taskText } = body;
  if (!type || !VALID_TYPES.includes(type as ActivityType)) {
    return error('VALIDATION_ERROR', `type must be one of: ${VALID_TYPES.join(', ')}`, 400);
  }
  if (!taskText || typeof taskText !== 'string') {
    return error('VALIDATION_ERROR', 'taskText is required', 400);
  }

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const month = new Date().toISOString().slice(0, 7);

  // Ownership check
  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );
  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  // Verify task exists in current plan
  const { Item: plan } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: `PLAN#${month}` } }),
  );
  const whatToDo = (plan?.['whatToDo'] as Array<{ text: string }>) ?? [];
  const taskExists = whatToDo.some((t) => t.text === taskText);
  if (!taskExists) return error('TASK_NOT_FOUND', 'Task not found in current plan', 400);

  // Compute new scores
  const currentScores: CategoryScores = (dog['categoryScores'] as CategoryScores) ?? {
    ...DEFAULT_CATEGORY_SCORES,
    trainingBehaviour: dog['wellnessScore'] as number ?? 50,
    feedingNutrition: dog['wellnessScore'] as number ?? 50,
    health: dog['wellnessScore'] as number ?? 50,
    socialisation: dog['wellnessScore'] as number ?? 50,
  };

  const category = assignCategory(taskText as string);
  const newCategoryScore = recalcScore(currentScores[category], type as ActivityType);
  const newCategoryScores: CategoryScores = { ...currentScores, [category]: newCategoryScore };
  const newWellnessScore = computeWellnessScore(newCategoryScores);

  const activityId = uuidv4();
  const now = new Date().toISOString();
  const ownerId = dog['ownerId'] as string;

  await Promise.all([
    docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `DOG#${dogId}`,
          SK: `ACTIVITY#${month}#${activityId}`,
          GSI1PK: `OWNER#${ownerId}`,
          GSI1SK: `ACTIVITY#${month}#${activityId}`,
          activityId,
          dogId,
          ownerId,
          type,
          taskText,
          category,
          month,
          createdAt: now,
        },
      }),
    ),
    docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET categoryScores = :catScores, wellnessScore = :score, updatedAt = :now',
        ExpressionAttributeValues: {
          ':catScores': newCategoryScores,
          ':score': newWellnessScore,
          ':now': now,
        },
      }),
    ),
  ]);

  return success(
    {
      activityId,
      dogId,
      type,
      taskText,
      category,
      categoryScores: newCategoryScores,
      wellnessScore: newWellnessScore,
      createdAt: now,
    },
    201,
  );
};
