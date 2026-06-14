import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export const getUserId = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string => {
  return event.requestContext.authorizer.jwt.claims['sub'] as string;
};

export const getUserGroups = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] => {
  const raw = event.requestContext.authorizer.jwt.claims['cognito:groups'];
  if (!raw) return [];
  // The HTTP API JWT authorizer serialises the array claim as a bracketed,
  // whitespace-delimited string (e.g. "[vets owners]"). Handle that plus the
  // comma-separated form and a genuine array, so group checks are robust.
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : String(raw).replace(/^\[/, '').replace(/\]$/, '').split(/[\s,]+/);
  return parts.map((g) => g.trim()).filter(Boolean);
};

export const isAdmin = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  getUserGroups(event).includes('admins');

export const isVet = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  getUserGroups(event).includes('vets');
