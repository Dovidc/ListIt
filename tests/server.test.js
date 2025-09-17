process.env.NODE_ENV = 'test';
if (!process.env.DB_PATH) {
  process.env.DB_PATH = ':memory:';
}

const request = require('supertest');
const app = require('../server');

const db = app._db;

async function resetDb() {
  const res = await request(app).post('/__test/reset');
  if (res.status !== 200) {
    throw new Error(`reset_failed:${res.status}`);
  }
}

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

describe('ListIt API basic flows', () => {
  it('supports listing creation and conversations', async () => {
    await resetDb();
    const seller = request.agent(app);
    const buyer = request.agent(app);

    let res = await seller.post('/api/register').send({ email: 'seller@test.com', password: 'secret1', username: 'sellerA' });
    expect(res.status).toBe(200);

    res = await buyer.post('/api/register').send({ email: 'buyer@test.com', password: 'secret1', username: 'buyerB' });
    expect(res.status).toBe(200);

    res = await seller.post('/api/listings').send({ title: 'Test Bike', description: 'Road ready bike', location: 'NYC, NY', price: 120 });
    expect(res.status).toBe(200);
    const listingId = res.body.id;
    const sellerId = res.body.user_id;

    const listRes = await buyer.get('/api/listings');
    expect(listRes.status).toBe(200);
    const listing = listRes.body.find(item => item.id === listingId);
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
});

describe('Admin reports dashboard', () => {
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

    res = await seller.post('/api/listings').send({ title: 'Vintage Camera', description: 'Works perfectly', location: 'Brooklyn, NY', price: 200 });
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
    const sellerConvo = sellerConvos.body.find(c => c.id === adminConvoId);
    expect(sellerConvo).toBeTruthy();
    expect(sellerConvo.last_message_sender_id).toBe(adminId);
    expect(Boolean(sellerConvo.last_message_is_admin)).toBe(true);
  });
});
