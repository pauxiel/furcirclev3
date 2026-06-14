import { getUserId, getUserGroups, isVet, isAdmin } from '../../src/lib/auth';
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

const makeGroupsEvent = (groups: unknown): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'u1', 'cognito:groups': groups }, scopes: [] },
        principalId: '', integrationLatency: 0,
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

describe('auth.getUserGroups', () => {
  it('returns [] when claim absent', () => {
    expect(getUserGroups(makeGroupsEvent(undefined))).toEqual([]);
  });

  it('parses the bracketed whitespace form from the HTTP API JWT authorizer', () => {
    expect(getUserGroups(makeGroupsEvent('[vets]'))).toEqual(['vets']);
    expect(getUserGroups(makeGroupsEvent('[vets owners]'))).toEqual(['vets', 'owners']);
  });

  it('parses comma-separated and array forms', () => {
    expect(getUserGroups(makeGroupsEvent('vets, owners'))).toEqual(['vets', 'owners']);
    expect(getUserGroups(makeGroupsEvent(['vets', 'admins']))).toEqual(['vets', 'admins']);
  });

  it('isVet / isAdmin work against the bracketed form', () => {
    expect(isVet(makeGroupsEvent('[vets]'))).toBe(true);
    expect(isVet(makeGroupsEvent('[owners]'))).toBe(false);
    expect(isAdmin(makeGroupsEvent('[admins owners]'))).toBe(true);
  });
});
