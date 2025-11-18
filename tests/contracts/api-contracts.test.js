process.env.NODE_ENV = 'test';
if (!process.env.DB_PATH) {
  process.env.DB_PATH = ':memory:';
}

const request = require('supertest');
const app = require('../../server');
const { API_VERSIONS } = require('../../contracts/versioning');
const {
  validateCreateListingRequest,
  validateUpdateListingRequest
} = require('../../contracts/http-schemas');
const mailService = require('../../mail-service');

async function resetDb() {
  const res = await request(app).post('/__test/reset');
  if (res.status !== 200) {
    throw new Error(`reset_failed:${res.status}`);
  }
}

function scrubAuthPayload(payload) {
  const copy = { ...payload };
  if (typeof copy.id === 'number') copy.id = '[id]';
  if (copy.token) copy.token = '[token]';
  if (copy.created_at) copy.created_at = '[iso]';
  if (copy.last_login_at) copy.last_login_at = '[iso]';
  if (copy.status_updated_at) copy.status_updated_at = '[iso]';
  if (copy.push_meta) {
    copy.push_meta = {
      available: !!copy.push_meta.available,
      vapid_public_key: copy.push_meta.vapid_public_key
    };
  }
  return copy;
}

describe('API contracts', () => {
  beforeAll(async () => {
    await app._runMigrations();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function registerAndVerify(agent, payload) {
    const registerRes = await agent
      .post('/api/register')
      .set('X-API-Version', API_VERSIONS.latest)
      .send({ email: payload.email, password: payload.password, username: payload.username });

    expect(registerRes.status).toBe(200);

    expect(registerRes.body).toEqual({ status: 'verification_required', email: payload.email });

    const code = mailService.__getLastVerificationCode(payload.email);
    expect(code).toMatch(/^\d{6}$/);

    const verifyRes = await agent
      .post('/api/register/verify')
      .set('X-API-Version', API_VERSIONS.latest)
      .send({ email: payload.email, code });

    expect(verifyRes.status).toBe(200);

    return { registerRes, verifyRes };
  }

  it('returns a stable payload for registration', async () => {
    const agent = request.agent(app);
    const registerPayload = { email: 'snapshot@test.com', password: 'secret1', username: 'snapshotUser' };
    const { registerRes, verifyRes } = await registerAndVerify(agent, registerPayload);

    expect(registerRes.headers['x-api-version']).toBe(API_VERSIONS.latest);
    expect(verifyRes.headers['x-api-version']).toBe(API_VERSIONS.latest);
    const scrubbed = scrubAuthPayload(verifyRes.body);
    expect(scrubbed).toMatchInlineSnapshot(`
{
  "account_status": "active",
  "created_at": "[iso]",
  "email": "snapshot@test.com",
  "id": "[id]",
  "is_admin": false,
  "last_login_at": "[iso]",
  "payments_disabled": false,
  "push_meta": {
    "available": false,
    "vapid_public_key": null,
  },
  "status_note": null,
  "status_updated_at": null,
  "token": "[token]",
  "username": "snapshotUser",
}
`);
  });

  it('provides granular validation details for invalid registration', async () => {
    const res = await request(app)
      .post('/api/register')
      .set('X-API-Version', API_VERSIONS.latest)
      .send({ email: 'not-an-email', password: '123', username: 'ab' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_request' });
    expect(res.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'email' }),
      expect.objectContaining({ path: 'password' }),
      expect.objectContaining({ path: 'username' }),
    ]));
  });

  it('rejects unsupported API versions before hitting route handlers', async () => {
    const res = await request(app)
      .post('/api/register')
      .set('X-API-Version', '2022-01-01')
      .send({ email: 'foo@test.com', password: 'secret1', username: 'foo' });

    expect(res.status).toBe(412);
    expect(res.body).toEqual({
      error: 'unsupported_version',
      latest: API_VERSIONS.latest,
      supported: API_VERSIONS.supported,
    });
  });

  it('enforces conversation message schema requirements', async () => {
    const alice = request.agent(app);
    const bob = request.agent(app);

    const aliceRes = await registerAndVerify(alice, { email: 'alice@test.com', password: 'secret1', username: 'aliceUser' });

    const bobRes = await registerAndVerify(bob, { email: 'bob@test.com', password: 'secret1', username: 'bobUser' });

    const convoRes = await alice
      .post('/api/conversations')
      .set('X-API-Version', API_VERSIONS.latest)
      .send({ with_user_id: bobRes.verifyRes.body.id });

    const badMessage = await alice
      .post(`/api/conversations/${convoRes.body.id}/messages`)
      .set('X-API-Version', API_VERSIONS.latest)
      .send({ body: '   ' });

    expect(badMessage.status).toBe(400);
    expect(badMessage.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'body' })
    ]));
  });
});

describe('listing schema validators', () => {
  it('requires location but not title or price when creating a listing', () => {
    const noTitleOrPrice = validateCreateListingRequest({
      location: 'City, ST',
      price: '',
      upload_tokens: ['tok-1']
    });

    expect(noTitleOrPrice.ok).toBe(true);
    expect(noTitleOrPrice.data.title).toBe('');
    expect(noTitleOrPrice.data.price).toBe(0);

    const missingLocation = validateCreateListingRequest({
      title: 'Nice chair',
      upload_tokens: ['tok-1']
    });

    expect(missingLocation.ok).toBe(false);
    expect(missingLocation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'location', code: 'required' })
    ]));

    const missingImages = validateCreateListingRequest({
      location: 'City, ST'
    });

    expect(missingImages.ok).toBe(false);
    expect(missingImages.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'upload_tokens', code: 'required' })
    ]));
  });

  it('enforces non-empty fields on listing updates', () => {
    const emptyTitle = validateUpdateListingRequest({ title: '   ' });
    expect(emptyTitle.ok).toBe(false);
    expect(emptyTitle.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', code: 'too_short' })
    ]));

    const emptyLocation = validateUpdateListingRequest({ location: '\n' });
    expect(emptyLocation.ok).toBe(false);
    expect(emptyLocation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'location', code: 'too_short' })
    ]));
  });
});

