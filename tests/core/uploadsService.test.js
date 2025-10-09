const path = require('path');

const distPath = path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.cjs');
// eslint-disable-next-line import/no-dynamic-require, global-require
const core = require(distPath);

const { createUploadsService } = core;

const BASE64_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HwAFgwJ/l4kS6QAAAABJRU5ErkJggg==';

describe('createUploadsService', () => {
  const utils = {
    measureImageFile: jest.fn().mockResolvedValue({ width: 1, height: 1 }),
    dedupeImageUrls: jest.fn((arr) => Array.from(new Set(arr))),
    collectListingImages: jest.fn(() => [])
  };

  test('uploads base64 image via API', async () => {
    const api = {
      signUpload: jest.fn().mockResolvedValue({
        uploadUrl: 'https://example.com/upload',
        publicUrl: 'https://cdn.example.com/item.png',
        Key: 'uploads/item.png'
      }),
      finalizeUpload: jest.fn().mockResolvedValue({}),
      getListingImages: jest.fn()
    };

    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    const service = createUploadsService({ api, utils, fetchImpl: fetchMock });
    await expect(service.uploadBase64Image(BASE64_PNG)).resolves.toBe(true);

    expect(api.signUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'upload.png', contentType: 'image/png' })
    );
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/upload', expect.objectContaining({ method: 'PUT' }));
    expect(api.finalizeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'uploads/item.png', url: 'https://cdn.example.com/item.png', bytes: expect.any(Number) }),
      expect.objectContaining({ silent: true })
    );
  });
});
