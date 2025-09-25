const path = require('path');
const { pathToFileURL } = require('url');

const React = require('istanbul-reports/node_modules/react');
const ReactDOM = require('istanbul-reports/node_modules/react-dom');
const TestUtils = require('istanbul-reports/node_modules/react-dom/test-utils');
const { JSDOM } = require('gensync/node_modules/jsdom');

global.React = React;
global.ReactDOM = ReactDOM;

function fileUrl(relativePath) {
  return pathToFileURL(path.join(__dirname, '..', relativePath)).href;
}

let ListingsProvider;
let UploadsProvider;
let useUploads;
let NotificationsProvider;
let ListingFormModal;
let jsdomInstance;

beforeAll(async () => {
  jsdomInstance = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  global.window = jsdomInstance.window;
  global.document = jsdomInstance.window.document;
  global.navigator = jsdomInstance.window.navigator;
  global.HTMLElement = jsdomInstance.window.HTMLElement;
  global.HTMLInputElement = jsdomInstance.window.HTMLInputElement;
  global.File = jsdomInstance.window.File;
  global.Blob = jsdomInstance.window.Blob;
  global.URL = jsdomInstance.window.URL;
  global.Node = jsdomInstance.window.Node;
  global.Event = jsdomInstance.window.Event;
  global.MouseEvent = jsdomInstance.window.MouseEvent;
  global.CustomEvent = jsdomInstance.window.CustomEvent;

  window.ListItCore = {
    createApiClient: () => ({}),
    formatCurrency: (value) => `$${Number(value ?? 0).toFixed(2)}`,
    formatDistance: () => '',
    haversineMeters: () => 0
  };

  ({ ListingsProvider } = await import(fileUrl('../public/features/listings/ListingsContext.mjs')));
  const uploadsModule = await import(fileUrl('../public/features/uploads/UploadsContext.mjs'));
  UploadsProvider = uploadsModule.UploadsProvider;
  useUploads = uploadsModule.useUploads;
  ({ NotificationsProvider } = await import(fileUrl('../public/features/notifications/NotificationsContext.mjs')));
  ({ ListingFormModal } = await import(fileUrl('../public/features/listings/components/ListingFormModal.mjs')));
});

beforeEach(() => {
  window.fetch = jest.fn(async () => ({ ok: true }));
  global.fetch = window.fetch;
  global.URL.createObjectURL = jest.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = jest.fn();
  window.alert = jest.fn();
  global.alert = window.alert;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 640;
      this.naturalHeight = 480;
    }

    set src(value) {
      this._src = value;
      setTimeout(() => {
        if (typeof this.onload === 'function') this.onload();
      }, 0);
    }
  }
  global.Image = FakeImage;

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 37.5, longitude: -122.4 } });
      }
    }
  });

  window.ListItCore = {
    createApiClient: () => ({}),
    formatCurrency: (value) => `$${Number(value ?? 0).toFixed(2)}`,
    formatDistance: () => '',
    haversineMeters: () => 0
  };
});

afterEach(async () => {
  jest.resetAllMocks();
});

afterAll(() => {
  if (jsdomInstance) {
    jsdomInstance.window.close();
  }
});

function OpenListingModal() {
  const { setShowForm } = useUploads();
  React.useEffect(() => {
    setShowForm(true);
  }, [setShowForm]);
  return React.createElement(ListingFormModal, { backgroundQueueEnabled: false });
}

async function renderModalWithProviders(api) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  await TestUtils.act(async () => {
    ReactDOM.render(
      React.createElement(
        NotificationsProvider,
        null,
        React.createElement(
          UploadsProvider,
          null,
          React.createElement(
            ListingsProvider,
            { api },
            React.createElement(OpenListingModal, null)
          )
        )
      ),
      container
    );
  });

  return {
    container,
    async unmount() {
      await TestUtils.act(async () => {
        ReactDOM.unmountComponentAtNode(container);
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }
  };
}

async function flushPromises() {
  await TestUtils.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ListingFormModal integration', () => {
  test('creates a listing with uploaded photos', async () => {
    const fakeApi = {
      listAll: jest.fn(async () => ({ rows: [], hasNext: false })),
      listMine: jest.fn(async () => []),
      getCoversBatch: jest.fn(async () => []),
      markListingSold: jest.fn(async () => {}),
      getListingImages: jest.fn(async () => []),
      aiAnalyze: jest.fn(async () => ({})),
      createListing: jest.fn(async () => ({ id: 101 })),
      updateListing: jest.fn(async () => ({ ok: true })),
      reverseGeocode: jest.fn(async () => ({ display: 'Test City', lat: 37.5, lon: -122.4 })),
      signUpload: jest.fn(async () => ({
        uploadUrl: 'https://uploads.test/file',
        publicUrl: 'https://cdn.test/image.jpg',
        Key: 'key-1'
      })),
      finalizeUpload: jest.fn(async () => ({
        uploadToken: 'token-1',
        url: 'https://cdn.test/image.jpg',
        width: 640,
        height: 480,
        bytes: 12345
      })),
      listAds: jest.fn(async () => [])
    };

    const { unmount } = await renderModalWithProviders(fakeApi);

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    await TestUtils.act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [file]
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await flushPromises();
    });

    const submitButton = Array.from(document.querySelectorAll('button')).find((btn) =>
      btn.textContent && btn.textContent.toLowerCase().includes('create listing')
    );
    expect(submitButton).toBeDefined();

    await TestUtils.act(async () => {
      submitButton.click();
      await flushPromises();
    });

    await flushPromises();

    expect(fakeApi.signUpload).toHaveBeenCalledWith({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      bytes: file.size
    });
    expect(window.fetch).toHaveBeenCalledWith('https://uploads.test/file', expect.objectContaining({ method: 'PUT' }));
    expect(fakeApi.finalizeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'key-1' }),
      expect.objectContaining({ silent: true })
    );
    expect(fakeApi.createListing).toHaveBeenCalledWith(
      expect.objectContaining({ upload_tokens: ['token-1'] })
    );

    await flushPromises();

    expect(document.querySelector('.modal.open')).toBeNull();

    await unmount();
  });
});
