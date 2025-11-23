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

loadFile('public/app/helpers.js');
loadFile('public/app/features/listings.js');

const { createListingsFeature } = window.ListItApp.features.listings;
const { createHelpers } = window.ListItApp.helpers;

// Mock React
let hooks = [];
let hookIndex = 0;
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
            if (prev.cleanup) prev.cleanup();
            const cleanup = fn();
            hooks[idx] = { deps, cleanup };
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
    createElement: () => { }
};

// Mock API
let apiCallCount = 0;
const api = {
    listAll: async () => {
        apiCallCount++;
        return { rows: [], hasNext: false };
    },
    listMine: async () => [],
    getListingImages: async () => [],
    getCoversBatch: async () => [],
    searchCities: async () => []
};

// Mock Helpers
const helpers = createHelpers({ React });

// Test
console.log('Testing Unstable User Dependency...');
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

// Simulate Renders
const runRender = (user) => {
    hookIndex = 0;
    useListingsFeature({ user, currentTab: 'browse' });
};

// Render 1: User A
const userA1 = { id: 1, name: 'User' };
runRender(userA1);

// Render 2: User A (new object, same ID) - this simulates unstable user object
const userA2 = { id: 1, name: 'User' };
runRender(userA2);

// Render 3: User A (new object, same ID)
const userA3 = { id: 1, name: 'User' };
runRender(userA3);

console.log('API Call Count:', apiCallCount);
if (apiCallCount > 1) {
    console.log('FAIL: API called multiple times despite same user ID');
} else {
    console.log('PASS: API called only once');
}
