import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
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

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  // If plan is still generating, return early with status
  if (dog['planStatus'] !== 'ready') {
    const month = new Date().toISOString().slice(0, 7);
    return success({ dogId, month, planStatus: dog['planStatus'] });
  }

  const month = new Date().toISOString().slice(0, 7);

  const { Item: plan } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: `PLAN#${month}` } }),
  );

  if (!plan) return error('PLAN_NOT_FOUND', 'No plan found for this month', 404);

  // Strip DynamoDB key fields from the response
  const { PK: _PK, SK: _SK, GSI1PK: _G1PK, GSI1SK: _G1SK, ...planData } = plan as Record<string, unknown>;

  return success(planData);
};
