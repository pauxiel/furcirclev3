import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

const sfn = new SFNClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;
  const stateMachineArn = process.env['STATE_MACHINE_ARN']!;
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('INVALID_REQUEST', 'dogId is required', 400);

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('NOT_FOUND', 'Dog not found', 404);

  await Promise.all([
    docClient.send(new UpdateCommand({
      TableName: table,
      Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' },
      UpdateExpression: 'SET planStatus = :generating',
      ExpressionAttributeValues: { ':generating': 'generating' },
    })),
    sfn.send(new StartExecutionCommand({
      stateMachineArn,
      name: `admin-refresh-${dogId}-${uuidv4()}`,
      input: JSON.stringify({ dogId, ownerId: dog['ownerId'] }),
    })),
  ]);

  return success({ dogId, planStatus: 'generating', triggeredAt: new Date().toISOString() });
};
