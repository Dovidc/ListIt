const fs = require('fs');
const path = require('path');

// Mock window
global.window = {
    ListItApp: {
        features: { admin: {} },
        components: {}
    },
    scrollTo: () => { },
    setTimeout: (fn) => fn(),
    clearTimeout: () => { }
};

// Load files
const loadFile = (p) => {
    const content = fs.readFileSync(path.resolve(__dirname, p), 'utf8');
    eval(content);
};

loadFile('public/app/helpers.js');
loadFile('public/app/features/listings.js');
loadFile('public/app/features/nearby.js');

const { createListingsFeature } = window.ListItApp.features.listings;
const { createNearbyFeature } = window.ListItApp.features.nearby;
const { createHelpers } = window.ListItApp.helpers;

// Mock React
let hooks = [];
let hookIndex = 0;
let effects = [];
const React = {
    useState: (init) => {
        const idx = hookIndex++;
        if (hooks.length <= idx) hooks.push(typeof init === 'function' ? init() : init);
        const setState = (val) => {
            hooks[idx] = typeof val === 'function' ? val(hooks[idx]) : val;
        };
        return [hooks[idx], setState];
    },
    useEffect: (fn, deps) => {
        const idx = hookIndex++;
        if (hooks.length <= idx) {
            hooks.push({ deps: undefined, cleanup: undefined });
        }
        const prev = hooks[idx];
        const changed = !prev.deps || !deps || deps.some((d, i) => d !== prev.deps[i]);
        if (changed) {
            effects.push(() => {
                if (prev.cleanup) prev.cleanup();
                const cleanup = fn();
                hooks[idx] = { deps, cleanup };
            });
        }
    },
    useMemo: (fn, deps) => {
        const idx = hookIndex++;
        if (hooks.length <= idx) hooks.push({ deps: undefined, val: undefined });
        const prev = hooks[idx];
        const changed = !prev.deps || !deps || deps.some((d, i) => d !== prev.deps[i]);
        if (changed) {
            hooks[idx] = { deps, val: fn() };
        }
        return hooks[idx].val;
    },
    useCallback: (fn, deps) => {
        const idx = hookIndex++;
        if (hooks.length <= idx) hooks.push({ deps: undefined, fn: undefined });
        const prev = hooks[idx];
        const changed = !prev.deps || !deps || deps.some((d, i) => d !== prev.deps[i]);
        if (changed) {
            hooks[idx] = { deps, fn };
        }
        return hooks[idx].fn;
    },
    useRef: (val) => {
        const idx = hookIndex++;
        if (hooks.length <= idx) hooks.push({ current: val });
        return hooks[idx];
    },
    createElement: () => { },
    memo: (c) => c
};

// Mock API
const api = {
    listAll: async () => ({ rows: [], hasNext: false }),
    listMine: async () => [],
    listNearby: async () => {
        // Simulate delay
        await new Promise(r => setTimeout(r, 10));
        return { items: [] };
    },
    getListingImages: async () => [],
    getCoversBatch: async () => [],
    searchCities: async () => []
};

// Mock Helpers
const helpers = createHelpers({ React });
// Mock useIsMounted
helpers.useIsMounted = () => {
    const ref = { current: true };
    React.useEffect(() => {
        ref.current = true;
        return () => { ref.current = false; };
    }, []);
    return () => ref.current;
};
helpers.fetchCoordsAndReverse = async () => ({ lat: 0, lon: 0, display: 'Test City' });

// Test
console.log('Testing Tab Switching Stability...');

const listingsFeature = createListingsFeature({
    React,
    api,
    helpers,
    uploads: {
        prepareListingForModal: () => ({ payload: {}, images: [] }),
        warmListingImages: () => { }
    }
});

const nearbyFeature = createNearbyFeature({
    React,
    api,
    helpers,
    components: {
        ListingCard: () => { },
        ListingsGrid: () => { }
    }
});

const { useListingsFeature } = listingsFeature;
const { NearbyPanel } = nearbyFeature;

// Simulate Tab Switching
let currentTab = 'browse';
let mountNearby = false;

const runRender = () => {
    hookIndex = 0;
    effects = [];

    // Render Listings Feature (always mounted in App)
    useListingsFeature({ user: { id: 1 }, currentTab });

    // Render Nearby Panel (conditionally mounted)
    if (mountNearby) {
        NearbyPanel({ user: { id: 1 }, setTab: () => { } });
    }

    // Run effects
    effects.forEach(fn => fn());
};

// Switch tabs rapidly
for (let i = 0; i < 20; i++) {
    currentTab = i % 2 === 0 ? 'browse' : 'nearby';
    mountNearby = currentTab === 'nearby';
    runRender();
}

console.log('PASS: Rapid tab switching completed without crash');
