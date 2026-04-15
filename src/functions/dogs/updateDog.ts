import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 501,
  body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }),
});
