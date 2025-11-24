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
    listAll: async ({ cursor }) => {
        apiCallCount++;
        // Simulate backend returning empty rows but hasNext=true (broken pagination or gap)
        return { rows: [], hasNext: true, next_cursor: 'cursor_2' };
    },
    listMine: async () => [],
    getListingImages: async () => [],
    getCoversBatch: async () => [],
    searchCities: async () => []
};

// Mock Helpers
const helpers = createHelpers({ React });

// Test
console.log('Testing Infinite Scroll Loop with Empty Results...');
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

// Simulate
hookIndex = 0;
const hook = useListingsFeature({ user: { id: 1 }, currentTab: 'browse' });

// Manually trigger loadListings via the exposed function (simulating observer)
// The hook exposes 'hasNext' and 'loadListings' (internal but we can grab it if we exposed it? No, we didn't expose loadListings directly in return... wait, we did? No, we exposed refreshListings)
// Actually, we can't easily trigger the internal loadListings from outside without exposing it.
// But we can check the internal state if we could access it.
// Instead, let's look at the code:
// If api returns rows: [], hasNext: true.
// setHasNext(true) is called.
// nextCursorRef.current is set to 'cursor_2'.
// The observer effect depends on [hasNext, loadListings].
// If hasNext is true, observer is active.
// If sentinel is visible (which it is if list is empty), observer callback fires.
// callback calls loadListings({ cursor: 'cursor_2' }).
// API called again. Returns rows: [], hasNext: true.
// Loop.

// We can verify this logic by inspection or by mocking the observer in the test.
// Let's mock IntersectionObserver.

global.IntersectionObserver = class {
    constructor(cb) {
        this.cb = cb;
    }
    observe() {
        // Simulate visibility immediately
        this.cb([{ isIntersecting: true }]);
    }
    disconnect() { }
};

// Re-run render to trigger effect
hookIndex = 0;
useListingsFeature({ user: { id: 1 }, currentTab: 'browse' });

// Wait for async effects
setTimeout(() => {
    console.log('API Call Count:', apiCallCount);
    if (apiCallCount > 5) {
        console.log('FAIL: Infinite loop detected');
    } else {
        console.log('PASS: No infinite loop');
    }
}, 1000);
