const path = require('path');

const distPath = path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.cjs');
// eslint-disable-next-line import/no-dynamic-require, global-require
const core = require(distPath);

const { createListingsService, normalizeListingsResponse } = core;

describe('listings helpers', () => {
  test('normalizeListingsResponse resolves rows and pagination', () => {
    const res = normalizeListingsResponse({ rows: [1, 2], total: 5, page: 2 }, 2);
    expect(res).toEqual({ rows: [1, 2], hasNext: true, nextCursor: null });
  });

  test('createListingsService fetches summaries', async () => {
    const api = {
      listAll: jest.fn().mockResolvedValue({
        rows: [
          { id: 5, title: 'Electric Bike', price: 1200, city: 'Austin' },
          { id: 'abc', title: 'Road Bike', price: '450', location: 'Dallas' }
        ],
        next_cursor: 'abc123'
      })
    };

    const service = createListingsService({ api, pageSize: 10 });
    const result = await service.fetch();

    expect(api.listAll).toHaveBeenCalledWith({ limit: 10, sort: 'new' }, undefined);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: '5', title: 'Electric Bike', subtitle: '$1,200.00 • Austin' });
    expect(result.nextCursor).toBe('abc123');
  });
});
