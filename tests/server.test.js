process.env.NODE_ENV = 'test';
if (!process.env.DB_PATH) {
  process.env.DB_PATH = ':memory:';
}

const skipServer = process.env.SKIP_SERVER_TESTS === '1';
const request = require('supertest');
let app = null;
let db = null;

if (!skipServer) {
  app = require('../server');
  db = app._db;
}

const maybeDescribe = skipServer ? describe.skip : describe;

function bodyItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
}

async function uploadTestImage(agent, overrides = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    key: `tests/${id}.jpg`,
    url: `https://example-bucket.s3.amazonaws.com/tests/${id}.jpg`,
    width: 640,
    height: 480,
    bytes: 12345,
    ...overrides
  };

  const res = await agent.post('/api/uploads/finalize').send(payload);
  expect(res.status).toBe(200);
  expect(res.body.uploadToken).toBeTruthy();
  return res.body.uploadToken;
}

async function resetDb() {
  if (!app) {
    return;
  }

  const res = await request(app).post('/__test/reset');
  if (res.status !== 200) {
    throw new Error(`reset_failed:${res.status}`);
  }
}

if (!skipServer) {
  beforeAll(async () => {
    await app._initializeSchema();
  });

  afterAll(() => {
    if (db && typeof db.close === 'function') {
      try { db.close(); } catch (err) {
        // ignore close errors in tests
      }
    }
  });
}

maybeDescribe('ListIt API basic flows', () => {
  it('supports listing creation and conversations', async () => {
    await resetDb();
    const seller = request.agent(app);
    const buyer = request.agent(app);

    let res = await seller.post('/api/register').send({ email: 'seller@test.com', password: 'secret1', username: 'sellerA' });
    expect(res.status).toBe(200);

    res = await buyer.post('/api/register').send({ email: 'buyer@test.com', password: 'secret1', username: 'buyerB' });
    expect(res.status).toBe(200);

    const uploadToken = await uploadTestImage(seller);

    res = await seller.post('/api/listings').send({ title: 'Test Bike', description: 'Road ready bike', location: 'NYC, NY', price: 120, upload_tokens: [uploadToken] });
    expect(res.status).toBe(200);
    const listingId = res.body.id;
    const sellerId = res.body.user_id;

    const listRes = await buyer.get('/api/listings');
    expect(listRes.status).toBe(200);
    const listing = bodyItems(listRes.body).find(item => item.id === listingId);
    expect(listing).toBeTruthy();

    let convoRes = await buyer.post('/api/conversations').send({ with_user_id: sellerId, listing_id: listingId });
    expect(convoRes.status).toBe(200);
    const convoId = convoRes.body.id;

    let msgRes = await buyer.post(`/api/conversations/${convoId}/messages`).send({ body: 'Hi!' });
    expect(msgRes.status).toBe(200);

    msgRes = await seller.get(`/api/conversations/${convoId}/messages`);
    expect(msgRes.status).toBe(200);
    expect(msgRes.body[0].body).toBe('Hi!');
  });

  it('keeps conversations for the other user when one participant deletes them', async () => {
    await resetDb();

    const alice = request.agent(app);

    const bob = request.agent(app);



    let res = await alice.post('/api/register').send({ email: 'alice@test.com', password: 'secret1', username: 'aliceUser' });

    expect(res.status).toBe(200);

    res = await bob.post('/api/register').send({ email: 'bob@test.com', password: 'secret1', username: 'bobUser' });

    expect(res.status).toBe(200);

    const bobId = res.body.id;



    res = await alice.post('/api/conversations').send({ with_user_id: bobId });

    expect(res.status).toBe(200);

    const convoId = res.body.id;



    res = await alice.post(`/api/conversations/${convoId}/messages`).send({ body: 'Hello Bob' });

    expect(res.status).toBe(200);



    res = await bob.get('/api/conversations');

    expect(res.status).toBe(200);

    const bobConvos = bodyItems(res.body);

    expect(bobConvos.some(c => c.id === convoId)).toBe(true);



    res = await alice.delete(`/api/conversations/${convoId}`);

    expect(res.status).toBe(200);



    res = await alice.get('/api/conversations');

    expect(res.status).toBe(200);

    const aliceConvos = bodyItems(res.body);

    expect(aliceConvos.find(c => c.id === convoId)).toBeUndefined();



    res = await bob.get('/api/conversations');

    expect(res.status).toBe(200);

    const stillThere = bodyItems(res.body).find(c => c.id === convoId);

    expect(stillThere).toBeTruthy();



    res = await bob.post(`/api/conversations/${convoId}/messages`).send({ body: 'Are you there?' });

    expect(res.status).toBe(200);

    expect(Boolean(res.body.other_user_deleted)).toBe(true);



    const aliceMessages = await alice.get(`/api/conversations/${convoId}/messages`);

    expect(aliceMessages.status).toBe(404);



    const bobMessages = await bob.get(`/api/conversations/${convoId}/messages`);

    expect(bobMessages.status).toBe(200);

    expect(Array.isArray(bobMessages.body)).toBe(true);

    expect(bobMessages.body.length).toBeGreaterThanOrEqual(1);
  });
});

maybeDescribe('Admin reports dashboard', () => {
  it('aggregates reported accounts', async () => {
    await resetDb();
    const admin = request.agent(app);
    const seller = request.agent(app);
    const reporter = request.agent(app);

    let res = await admin.post('/api/register').send({ email: 'admin@test.com', password: 'secret1', username: 'adminUser' });
    expect(res.status).toBe(200);
    const adminId = res.body.id;
    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminId);
    res = await admin.post('/api/login').send({ email: 'admin@test.com', password: 'secret1' });
    expect(res.status).toBe(200);

    res = await seller.post('/api/register').send({ email: 'seller@test.com', password: 'secret1', username: 'sellerUser' });
    expect(res.status).toBe(200);
    const sellerId = res.body.id;

    const uploadToken = await uploadTestImage(seller);

    res = await seller.post('/api/listings').send({ title: 'Vintage Camera', description: 'Works perfectly', location: 'Brooklyn, NY', price: 200, upload_tokens: [uploadToken] });
    expect(res.status).toBe(200);
    const listingId = res.body.id;

    res = await reporter.post('/api/register').send({ email: 'reporter@test.com', password: 'secret1', username: 'reporterUser' });
    expect(res.status).toBe(200);

    const reportPayload = {
      reported_user_id: sellerId,
      listing_id: listingId,
      reasons: ['spam'],
      details: 'Likely scam',
      captcha: { a: 2, b: 3, answer: 5 }
    };
    res = await reporter.post('/api/reports').send(reportPayload);
    expect(res.status).toBe(200);

    const topRes = await admin.get('/api/admin/reports/top?limit=5&days=30');
    expect(topRes.status).toBe(200);
    expect(Array.isArray(topRes.body.items)).toBe(true);
    const target = topRes.body.items.find(item => item.user_id === sellerId);
    expect(target).toBeTruthy();
    expect(target.total_reports).toBe(1);
    expect(target.open_reports).toBe(1);
    expect(target.recent_reports).toBe(1);

    const convoRes = await admin.post('/api/conversations').send({ with_user_id: sellerId });
    expect(convoRes.status).toBe(200);
    const adminConvoId = convoRes.body.id;

    const warnRes = await admin.post(`/api/conversations/${adminConvoId}/messages`).send({ body: 'Please follow the guidelines.' });
    expect(warnRes.status).toBe(200);

    const sellerConvos = await seller.get('/api/conversations');
    expect(sellerConvos.status).toBe(200);
    const sellerConvo = bodyItems(sellerConvos.body).find(c => c.id === adminConvoId);
    expect(sellerConvo).toBeTruthy();
    expect(sellerConvo.last_message_sender_id).toBe(adminId);
    expect(Boolean(sellerConvo.last_message_is_admin)).toBe(true);
  });
});

maybeDescribe('Admin test listing utilities', () => {
  it('seeds and clears demo listings', async () => {
    await resetDb();

    const admin = request.agent(app);

    let res = await admin.post('/api/register').send({ email: 'seed-admin@test.com', password: 'secret1', username: 'seedAdmin' });
    expect(res.status).toBe(200);
    const adminId = res.body.id;
    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminId);

    res = await admin.post('/api/login').send({ email: 'seed-admin@test.com', password: 'secret1' });
    expect(res.status).toBe(200);

    res = await admin.post('/api/admin/listings/seed').send({ count: 3 });
    expect(res.status).toBe(200);
    const createdCount = Number(res.body.created || 0);
    expect(createdCount).toBe(3);

    res = await admin.get('/api/listings');
    expect(res.status).toBe(200);
    const seededListings = bodyItems(res.body);
    expect(Array.isArray(seededListings)).toBe(true);
    expect(seededListings.length).toBe(createdCount);
    expect(seededListings.every(item => item.owner_username === 'seed_seller')).toBe(true);

    const idsParam = seededListings.map(item => item.id).join(',');
    expect(idsParam).not.toBe('');

    const coversRes = await admin.get(`/api/listings/covers?ids=${idsParam}`);
    expect(coversRes.status).toBe(200);
    expect(Array.isArray(coversRes.body)).toBe(true);
    expect(coversRes.body.length).toBeGreaterThan(0);
    expect(coversRes.body.every(row => row && row.image_data)).toBe(true);

    res = await admin.delete('/api/admin/listings/seed');
    expect(res.status).toBe(200);
    expect(Number(res.body.deleted || 0)).toBe(createdCount);

    res = await admin.get('/api/listings');
    expect(res.status).toBe(200);
    expect(bodyItems(res.body).length).toBe(0);
  });
});

maybeDescribe('Locked account restrictions', () => {
  it('restricts selling actions but allows messaging admins', async () => {
    await resetDb();

    const admin = request.agent(app);
    const seller = request.agent(app);
    const buyer = request.agent(app);

    let res = await admin.post('/api/register').send({ email: 'admin2@test.com', password: 'secret1', username: 'superAdmin' });
    expect(res.status).toBe(200);
    const adminId = res.body.id;
    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminId);
    await admin.post('/api/login').send({ email: 'admin2@test.com', password: 'secret1' });

    res = await seller.post('/api/register').send({ email: 'seller2@test.com', password: 'secret1', username: 'lockableSeller' });
    expect(res.status).toBe(200);
    const sellerId = res.body.id;
    await seller.post('/api/login').send({ email: 'seller2@test.com', password: 'secret1' });

    res = await buyer.post('/api/register').send({ email: 'buyer2@test.com', password: 'secret1', username: 'regularBuyer' });
    expect(res.status).toBe(200);
    const buyerId = res.body.id;

    const listingPayload = { title: 'Road Bike', description: 'Great condition', location: 'NYC, NY', price: 250 };
    const uploadToken = await uploadTestImage(seller);

    res = await seller.post('/api/listings').send({ ...listingPayload, upload_tokens: [uploadToken] });
    expect(res.status).toBe(200);
    const listingId = res.body.id;

    res = await seller.post('/api/conversations').send({ with_user_id: buyerId, listing_id: listingId });
    expect(res.status).toBe(200);
    const convoId = res.body.id;
    res = await seller.post(`/api/conversations/${convoId}/messages`).send({ body: 'Hello there' });
    expect(res.status).toBe(200);

    await db.prepare('UPDATE users SET account_status = ? WHERE id = ?').run('locked', sellerId);

    res = await seller.post('/api/login').send({ email: 'seller2@test.com', password: 'secret1' });
    expect(res.status).toBe(200);
    expect(res.body.account_status).toBe('locked');

    res = await seller.get('/api/listings');
    expect(res.status).toBe(200);

    res = await seller.post('/api/listings').send({ title: 'Another', description: 'Nope', location: 'NYC, NY', price: 10 });
    expect(res.status).toBe(423);

    res = await seller.put(`/api/listings/${listingId}`).send({ title: 'Updated' });
    expect(res.status).toBe(423);

    res = await seller.delete(`/api/listings/${listingId}`);
    expect(res.status).toBe(423);

    res = await seller.post(`/api/conversations/${convoId}/messages`).send({ body: 'Are you there?' });
    expect(res.status).toBe(423);

    res = await seller.post('/api/conversations').send({ with_user_id: buyerId });
    expect(res.status).toBe(423);

    res = await seller.post('/api/conversations').send({ with_user_id: adminId });
    expect(res.status).toBe(200);
    const adminConvoId = res.body.id;

    res = await seller.post(`/api/conversations/${adminConvoId}/messages`).send({ body: 'Need assistance' });
    expect(res.status).toBe(200);
  });
});

maybeDescribe('Nearby listings endpoint', () => {
  it('returns nearby listings via fallback distance calculations when PostGIS is disabled', async () => {
    await resetDb();
    expect(app._features.postgisNearby).toBe(false);

    const seller = request.agent(app);
    await seller.post('/api/register').send({ email: 'geo@test.com', password: 'secret1', username: 'geoSeller' });

    const uploadToken = await uploadTestImage(seller);

    const createRes = await seller.post('/api/listings').send({
      title: 'Central Item',
      description: 'Located downtown',
      location: 'Geo City',
      price: 10,
      enable_nearby: true,
      lat: 40.0,
      lon: -74.0,
      upload_tokens: [uploadToken]
    });
    expect(createRes.status).toBe(200);

    const res = await seller.get('/api/listings/nearby?lat=40&lon=-74&radius_m=150');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(createRes.body.id);
    expect(res.body[0].distance_m).toBe(0);
  });

  it('builds a PostGIS-powered query when the feature flag is enabled', async () => {
    await resetDb();

    const originalPrepare = app._db.prepare;
    const features = app._features;
    const originalFeature = features.postgisNearby;
    let capturedSql = '';

    features.postgisNearby = true;

    app._db.prepare = function patchedPrepare(sql) {
      if (/ST_DWithin/i.test(sql)) {
        capturedSql = sql;
        return {
          all: async () => ([{
            id: 999,
            user_id: 1,
            image_data: null,
            title: 'Stub',
            description: 'Stub desc',
            location: 'Nowhere',
            price: 5,
            created_at: new Date().toISOString(),
            lat: 1,
            lon: 2,
            owner_username: 'stub',
            distance_m: 42.4
          }])
        };
      }
      return originalPrepare.call(this, sql);
    };

    try {
      const res = await request(app).get('/api/listings/nearby?lat=1&lon=2&radius_m=500');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].distance_m).toBe(42);
      expect(capturedSql).toContain('ST_DWithin');
      expect(capturedSql).toContain('ST_Distance');
    } finally {
      app._db.prepare = originalPrepare;
      features.postgisNearby = originalFeature;
    }
  });
});
