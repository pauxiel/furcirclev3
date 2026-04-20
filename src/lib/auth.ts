import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export const getUserId = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string => {
  return event.requestContext.authorizer.jwt.claims['sub'] as string;
};

export const getUserGroups = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] => {
  const raw = event.requestContext.authorizer.jwt.claims['cognito:groups'];
  if (!raw) return [];
  // API Gateway serialises array claims as comma-separated strings
  return String(raw).split(',').map((g) => g.trim()).filter(Boolean);
};

export const isAdmin = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  getUserGroups(event).includes('admins');
