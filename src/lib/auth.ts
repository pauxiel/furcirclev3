import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export const getUserId = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string => {
  return event.requestContext.authorizer.jwt.claims['sub'] as string;
};
