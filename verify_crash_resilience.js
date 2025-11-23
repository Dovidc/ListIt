const fs = require('fs');
const path = require('path');

// Mock window
global.window = {
    ListItApp: {
        features: { admin: {} },
        components: {}
    }
};

// Load files
const loadFile = (p) => {
    const content = fs.readFileSync(path.resolve(__dirname, p), 'utf8');
    eval(content);
};

loadFile('public/app/features/listings.js');
loadFile('public/app/features/admin/state.js');
loadFile('public/app/components/media.js');

const { createListingsFeature } = window.ListItApp.features.listings;
const { createAdminStateModule } = window.ListItApp.features.admin;
const { createMediaComponents } = window.ListItApp.components.media;

// Mock React
const React = {
    useState: (init) => [init, () => { }],
    useEffect: () => { },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (val) => ({ current: val }),
    createElement: (tag, props, ...children) => ({ tag, props, children })
};

// Mock API
const api = {
    listAll: async () => ({ rows: [], hasNext: false }),
    adminSearchUsers: async () => [],
    getListingImages: async () => [],
    getCoversBatch: async () => [],
    listMine: async () => [],
    searchCities: async () => []
};

// Mock Helpers
const helpers = {
    normalizeListingsResponse: () => ({ rows: [], hasNext: false }),
    asArray: (v) => Array.isArray(v) ? v : [],
    selectPrimaryListingImage: () => null,
    safeTrim: (s) => (typeof s === 'string' ? s.trim() : ''),
    useIsMounted: () => () => true
};

// Test Listings Feature
console.log('Testing Listings Feature...');
try {
    const feature = createListingsFeature({
        React,
        api,
        helpers,
        uploads: {
            prepareListingForModal: () => ({ payload: {}, images: [] }),
            warmListingImages: () => { }
        }
    });
    const { useListingsFeature } = feature;
    const hook = useListingsFeature({ user: null, currentTab: 'browse' });
    console.log('Listings Feature initialized successfully.');
    if (hook.error !== null) console.error('Expected error to be null, got:', hook.error);
} catch (e) {
    console.error('Listings Feature crashed:', e);
}

// Test Admin State
console.log('Testing Admin State...');
try {
    const adminModule = createAdminStateModule({ React, api });
    const { useAdminDashboardState } = adminModule;
    const hook = useAdminDashboardState({});
    console.log('Admin State initialized successfully.');
} catch (e) {
    console.error('Admin State crashed:', e);
}

// Test Media Components
console.log('Testing Media Components...');
try {
    const mediaModule = createMediaComponents({ React, ReactDOM: { createPortal: () => { } } });
    const { ResponsiveImage } = mediaModule;
    const img = ResponsiveImage({ src: null });
    console.log('ResponsiveImage rendered with null src:', img.props.src && img.props.src.startsWith('data:'));
} catch (e) {
    console.error('Media Components crashed:', e);
}
