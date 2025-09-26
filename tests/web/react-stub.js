const Fragment = Symbol('Fragment');

function createElement(type, props, ...children) {
  const flatChildren = [].concat(...children);
  const nextProps = Object.assign({}, props);
  if (flatChildren.length === 1) {
    nextProps.children = flatChildren[0];
  } else if (flatChildren.length > 1) {
    nextProps.children = flatChildren;
  }
  return { type, props: nextProps };
}

function depsChanged(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return true;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return true;
  }
  return false;
}

function toChildArray(value) {
  if (value == null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function applyProps(node, props) {
  Object.keys(props || {}).forEach((key) => {
    if (key === 'children') return;
    const value = props[key];
    if (key === 'className') {
      node.setAttribute('class', value);
    } else if (key === 'style' && value && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'htmlFor') {
      node.setAttribute('for', value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      node.addEventListener(eventName, value);
    } else if (key === 'value' || key === 'checked') {
      node[key] = value;
    } else if (value === false || value == null) {
      node.removeAttribute(key);
    } else {
      node.setAttribute(key, value);
    }
  });
}

function createContext(defaultValue) {
  const id = Symbol('context');
  function Provider(props) {
    Provider.__currentValue = props.value;
    return props.children || null;
  }
  Provider.__isContextProvider = true;
  Provider.__contextId = id;
  return { _id: id, _default: defaultValue, Provider };
}

function createRoot(container) {
  const state = {
    container,
    element: null,
    states: new Map(),
    memos: new Map(),
    refs: new Map(),
    effects: new Map(),
    pendingEffects: [],
    currentComponentPath: '',
    currentHookIndex: 0,
    currentContextMap: new Map(),
    isRendering: false,
    isScheduled: false
  };

  function scheduleRender() {
    if (state.isScheduled) return;
    state.isScheduled = true;
    Promise.resolve().then(() => {
      state.isScheduled = false;
      renderElementTree();
    });
  }

  function runEffects() {
    const effects = state.pendingEffects.splice(0, state.pendingEffects.length);
    effects.forEach((run) => run());
  }

  function renderElementTree() {
    if (!state.element) {
      state.container.innerHTML = '';
      return;
    }
    state.isRendering = true;
    const baseContext = new Map();
    state.currentContextMap = baseContext;
    const node = renderNode(state.element, '0', baseContext);
    state.container.innerHTML = '';
    if (node) {
      state.container.appendChild(node);
    }
    state.isRendering = false;
    runEffects();
  }

  function renderNode(element, path, contextMap) {
    if (element == null || element === false) {
      return document.createComment('');
    }

    if (typeof element === 'string' || typeof element === 'number') {
      return document.createTextNode(String(element));
    }

    if (Array.isArray(element)) {
      const frag = document.createDocumentFragment();
      element.forEach((child, index) => {
        const childNode = renderNode(child, `${path}.${index}`, contextMap);
        if (childNode) frag.appendChild(childNode);
      });
      return frag;
    }

    const { type, props = {} } = element;

    if (type === Fragment) {
      const children = toChildArray(props.children);
      const frag = document.createDocumentFragment();
      children.forEach((child, index) => {
        const childNode = renderNode(child, `${path}.${index}`, contextMap);
        if (childNode) frag.appendChild(childNode);
      });
      return frag;
    }

    if (typeof type === 'function') {
      if (type.__isContextProvider) {
        const nextMap = new Map(contextMap);
        nextMap.set(type.__contextId, props.value);
        const children = toChildArray(props.children);
        const frag = document.createDocumentFragment();
        children.forEach((child, index) => {
          const childNode = renderNode(child, `${path}.${index}`, nextMap);
          if (childNode) frag.appendChild(childNode);
        });
        return frag;
      }

      const prevPath = state.currentComponentPath;
      const prevIndex = state.currentHookIndex;
      const prevContext = state.currentContextMap;

      state.currentComponentPath = path;
      state.currentHookIndex = 0;
      state.currentContextMap = contextMap;

      const output = type(props);
      const node = renderNode(output, `${path}.0`, state.currentContextMap);

      state.currentComponentPath = prevPath;
      state.currentHookIndex = prevIndex;
      state.currentContextMap = prevContext;
      return node;
    }

    const node = document.createElement(type);
    applyProps(node, props);
    const children = toChildArray(props.children);
    children.forEach((child, index) => {
      const childNode = renderNode(child, `${path}.${index}`, contextMap);
      if (childNode) node.appendChild(childNode);
    });
    return node;
  }

  function ensureHook(map, path) {
    if (!map.has(path)) {
      map.set(path, []);
    }
    return map.get(path);
  }

  function useState(initialValue) {
    const path = state.currentComponentPath;
    const index = state.currentHookIndex++;
    const hooks = ensureHook(state.states, path);
    if (hooks.length <= index) {
      hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
    }
    const setState = (value) => {
      const nextValue = typeof value === 'function' ? value(hooks[index]) : value;
      if (Object.is(nextValue, hooks[index])) return;
      hooks[index] = nextValue;
      if (state.isRendering) {
        scheduleRender();
      } else {
        renderElementTree();
      }
    };
    return [hooks[index], setState];
  }

  function useRef(initialValue) {
    const path = state.currentComponentPath;
    const index = state.currentHookIndex++;
    const hooks = ensureHook(state.refs, path);
    if (hooks.length <= index) {
      hooks[index] = { current: initialValue };
    }
    return hooks[index];
  }

  function useMemo(factory, deps) {
    const path = state.currentComponentPath;
    const index = state.currentHookIndex++;
    const hooks = ensureHook(state.memos, path);
    const record = hooks[index];
    if (!record || depsChanged(record.deps, deps)) {
      const value = factory();
      hooks[index] = { value, deps };
      return value;
    }
    return record.value;
  }

  function useCallback(callback, deps) {
    return useMemo(() => callback, deps);
  }

  function useContext(context) {
    const map = state.currentContextMap;
    if (map && map.has(context._id)) {
      return map.get(context._id);
    }
    return context._default;
  }

  function useEffect(effect, deps) {
    const path = state.currentComponentPath;
    const index = state.currentHookIndex++;
    const key = `${path}:${index}`;
    const record = state.effects.get(key);
    if (!record || depsChanged(record.deps, deps)) {
      state.pendingEffects.push(() => {
        if (record && typeof record.cleanup === 'function') {
          try { record.cleanup(); } catch (err) { /* ignore */ }
        }
        const cleanup = effect() || null;
        state.effects.set(key, { deps, cleanup });
      });
    }
  }

  const React = {
    createElement,
    Fragment,
    useState,
    useMemo,
    useCallback,
    useRef,
    useContext,
    useEffect,
    createContext
  };

  const ReactDOM = {
    createRoot(target) {
      state.container = target;
      return {
        render(element) {
          state.element = element;
          renderElementTree();
        },
        unmount() {
          state.element = null;
          state.container.innerHTML = '';
          state.states.clear();
          state.memos.clear();
          state.refs.clear();
          state.effects.forEach((record) => {
            if (record && typeof record.cleanup === 'function') {
              try { record.cleanup(); } catch (err) { /* ignore */ }
            }
          });
          state.effects.clear();
        }
      };
    }
  };

  React.__scheduleRender = scheduleRender;

  return { React, ReactDOM };
}

const { React, ReactDOM } = createRoot(document.createElement('div'));

module.exports = { React, ReactDOM };
