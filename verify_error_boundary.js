const fs = require('fs');
const path = require('path');

// Mock window
global.window = {
    ListItApp: {
        components: {}
    },
    location: { reload: () => console.log('Reload called') }
};

// Load files
const loadFile = (p) => {
    const content = fs.readFileSync(path.resolve(__dirname, p), 'utf8');
    eval(content);
};

loadFile('public/app/components/error-boundary.js');

const { createErrorBoundary } = window.ListItApp.components.errorBoundary;

// Mock React
const React = {
    createElement: (tag, props, ...children) => ({ tag, props, children }),
    Component: class Component {
        constructor(props) { this.props = props; this.state = {}; }
        setState(newState) { this.state = { ...this.state, ...newState }; }
    }
};

// Test
console.log('Testing GlobalErrorBoundary...');

const { GlobalErrorBoundary } = createErrorBoundary({ React });
const instance = new GlobalErrorBoundary({});

// Simulate error
const error = new Error('Test Error');
const stateUpdate = GlobalErrorBoundary.getDerivedStateFromError(error);

if (stateUpdate.hasError && stateUpdate.error === error) {
    console.log('PASS: getDerivedStateFromError correctly updates state');
} else {
    console.error('FAIL: getDerivedStateFromError failed');
}

instance.state = stateUpdate;
const renderResult = instance.render();

if (renderResult.tag === 'div' && renderResult.children.some(c => c.tag === 'h1' && c.children[0] === 'Something went wrong')) {
    console.log('PASS: Fallback UI rendered correctly');
} else {
    console.error('FAIL: Fallback UI not rendered');
}

instance.handleReload();
console.log('PASS: Reload handler executed');
