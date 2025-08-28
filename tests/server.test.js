/* tests/server.test.js (smoke + multi image) */

const request = require('supertest');
const app = require('../server');

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z/C/HwAF/gL+oX2nxQAAAABJRU5ErkJggg==';

describe('ListIt API (multi-images)', () => {
  const a = request.agent(app);
  const b = request.agent(app);
  let listingId;
  let convoId;

  it('reset db', async () => {
    const res = await request(app).post('/__test/reset');
    expect(res.status).toBe(200);
  });

  it('registers users A and B', async () => {
    let res = await a.post('/api/register').send({ email: 'a@test.com', password: 'secret1' });
    expect(res.status).toBe(200);
    res = await b.post('/api/register').send({ email: 'b@test.com', password: 'secret1' });
    expect(res.status).toBe(200);
  });

  it('A creates a listing with two images', async () => {
    const res = await a.post('/api/listings').send({ images: [IMG, IMG], description: 'Test Bike', location: 'NYC, NY', price: 120 });
    expect(res.status).toBe(200);
    listingId = res.body.id;
    expect(listingId).toBeGreaterThan(0);
    // fetch images
    const resImgs = await request(app).get(`/api/listings/${listingId}/images`);
    expect(resImgs.status).toBe(200);
    expect(resImgs.body.length).toBe(2);
  });

  it('B starts a conversation with A for that listing and messages', async () => {
    const resList = await b.get('/api/listings');
    expect(resList.status).toBe(200);
    const listing = resList.body.find(x => x.id === listingId);
    expect(listing).toBeTruthy();
    const resConvo = await b.post('/api/conversations').send({ with_user_id: listing.user_id, listing_id: listing.id });
    expect(resConvo.status).toBe(200);
    convoId = resConvo.body.id;
    expect(convoId).toBeGreaterThan(0);

    let res = await b.post(`/api/conversations/${convoId}/messages`).send({ body: 'Hi!' });
    expect(res.status).toBe(200);
    res = await a.get(`/api/conversations/${convoId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body[0].body).toBe('Hi!');
  });
});
