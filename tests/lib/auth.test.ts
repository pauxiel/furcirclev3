import { getUserId } from '../../src/lib/auth';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (sub?: string): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    requestContext: {
      authorizer: {
        jwt: {
          claims: sub ? { sub } : {},
          scopes: [],
        },
        principalId: '',
        integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

describe('auth.getUserId', () => {
  it('extracts sub from Cognito JWT claims', () => {
    expect(getUserId(makeEvent('cognito-uuid-123'))).toBe('cognito-uuid-123');
  });

  it('throws when no requestContext present', () => {
    expect(() => getUserId({} as APIGatewayProxyEventV2WithJWTAuthorizer)).toThrow();
  });
});
