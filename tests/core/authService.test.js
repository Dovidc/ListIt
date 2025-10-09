const path = require('path');

const distPath = path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.cjs');
// eslint-disable-next-line import/no-dynamic-require, global-require
const core = require(distPath);

const { createAuthService, ApiError } = core;

describe('createAuthService', () => {
  test('validates credentials and returns tokens', async () => {
    const api = {
      login: jest.fn().mockResolvedValue({ token: 'abc123', refreshToken: 'ref456', expiresAt: 1234567890 }),
      logout: jest.fn().mockResolvedValue()
    };

    const service = createAuthService({ api });
    const result = await service.signIn({ email: 'user@example.com', password: 'secret' });

    expect(api.login).toHaveBeenCalledWith('user@example.com', 'secret', undefined);
    expect(result.tokens).toEqual({
      token: 'abc123',
      accessToken: 'abc123',
      refreshToken: 'ref456',
      expiresAt: 1234567890
    });
    expect(result.user).toEqual({ token: 'abc123', refreshToken: 'ref456', expiresAt: 1234567890 });
  });

  test('throws ApiError for invalid email', () => {
    const api = { login: jest.fn(), logout: jest.fn() };
    const service = createAuthService({ api });

    expect(() => service.validateCredentials({ email: 'not-an-email', password: 'secret' })).toThrow(ApiError);
  });

  test('extractTokens handles missing tokens gracefully', () => {
    const api = { login: jest.fn(), logout: jest.fn() };
    const service = createAuthService({ api });

    expect(service.extractTokens({ token: 'xyz' })).toEqual({
      token: 'xyz',
      accessToken: 'xyz',
      refreshToken: null,
      expiresAt: null
    });
    expect(service.extractTokens({})).toBeNull();
  });
});
