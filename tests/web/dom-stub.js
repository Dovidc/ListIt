class Node {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.eventListeners = Object.create(null);
  }

  appendChild(node) {
    if (node instanceof DocumentFragment) {
      const fragmentChildren = node.childNodes.slice();
      fragmentChildren.forEach((child) => {
        node.removeChild(child);
        this.appendChild(child);
      });
      return node;
    }
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  set textContent(value) {
    this.childNodes = [];
    if (value != null && value !== '') {
      this.appendChild(new TextNode(String(value)));
    }
  }

  addEventListener(type, listener) {
    const key = String(type);
    if (!this.eventListeners[key]) {
      this.eventListeners[key] = [];
    }
    this.eventListeners[key].push(listener);
  }

  removeEventListener(type, listener) {
    const key = String(type);
    const list = this.eventListeners[key];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('Invalid event');
    }
    if (!event.target) {
      event.target = this;
    }
    event.currentTarget = this;
    const list = this.eventListeners[event.type];
    if (list) {
      for (const handler of list.slice()) {
        handler.call(this, event);
      }
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }
}

class DocumentFragment extends Node {
  constructor() {
    super(11);
  }

  querySelector(selector) {
    return findMatchingNode(this, selector, true);
  }

  querySelectorAll(selector) {
    return findMatchingNode(this, selector, false);
  }
}

function parseSimpleSelector(selector) {
  if (typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (!trimmed) return null;

  const result = {
    tag: null,
    id: null,
    classes: [],
    attributes: []
  };

  let index = 0;
  while (index < trimmed.length) {
    const char = trimmed[index];
    if (char === '#') {
      index += 1;
      let end = index;
      while (end < trimmed.length && /[\w-]/.test(trimmed[end])) {
        end += 1;
      }
      if (end === index) return null;
      result.id = trimmed.slice(index, end);
      index = end;
    } else if (char === '.') {
      index += 1;
      let end = index;
      while (end < trimmed.length && /[\w-]/.test(trimmed[end])) {
        end += 1;
      }
      if (end === index) return null;
      result.classes.push(trimmed.slice(index, end));
      index = end;
    } else if (char === '[') {
      const closeIndex = trimmed.indexOf(']', index + 1);
      if (closeIndex === -1) return null;
      const content = trimmed.slice(index + 1, closeIndex).trim();
      if (!content) return null;
      const equalsIndex = content.indexOf('=');
      if (equalsIndex === -1) {
        result.attributes.push({ name: content, value: null });
      } else {
        const name = content.slice(0, equalsIndex).trim();
        let value = content.slice(equalsIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result.attributes.push({ name, value });
      }
      index = closeIndex + 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else {
      const tagMatch = trimmed.slice(index).match(/^[A-Za-z][\w-]*|^\*/);
      if (!tagMatch) return null;
      if (tagMatch[0] !== '*') {
        result.tag = tagMatch[0].toUpperCase();
      }
      index += tagMatch[0].length;
    }
  }

  return result;
}

function matchesParsedSelector(element, parsed) {
  if (!(element instanceof ElementNode)) return false;
  if (!parsed) return false;

  if (parsed.tag && element.tagName !== parsed.tag) return false;

  if (parsed.id) {
    const actualId = element.getAttribute('id');
    if (actualId !== parsed.id) return false;
  }

  if (parsed.classes.length > 0) {
    const className = element.className || '';
    const classList = className.split(/\s+/).filter(Boolean);
    for (const expected of parsed.classes) {
      if (!classList.includes(expected)) {
        return false;
      }
    }
  }

  for (const attr of parsed.attributes) {
    const actual = element.getAttribute(attr.name);
    if (attr.value == null) {
      if (actual == null) return false;
    } else if (actual !== attr.value) {
      return false;
    }
  }

  return true;
}

function traverseForSelector(node, parsed, results, firstOnly) {
  if (!node || !node.childNodes) return false;
  for (const child of node.childNodes) {
    if (child instanceof ElementNode && matchesParsedSelector(child, parsed)) {
      results.push(child);
      if (firstOnly) {
        return true;
      }
    }
    if (child.childNodes && child.childNodes.length) {
      if (traverseForSelector(child, parsed, results, firstOnly)) {
        return true;
      }
    }
  }
  return false;
}

function findMatchingNode(root, selector, firstOnly) {
  const parsed = parseSimpleSelector(selector);
  if (!parsed) {
    return firstOnly ? null : [];
  }
  const results = [];
  traverseForSelector(root, parsed, results, firstOnly);
  if (firstOnly) {
    return results.length ? results[0] : null;
  }
  return results;
}

class CommentNode extends Node {
  constructor(data) {
    super(8);
    this.data = data || '';
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }
}

class TextNode extends Node {
  constructor(text) {
    super(3);
    this.data = String(text);
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }
}

class StyleDeclaration {
  constructor() {
    this._store = Object.create(null);
  }

  setProperty(name, value) {
    this._store[name] = String(value);
  }

  getPropertyValue(name) {
    return this._store[name] || '';
  }
}

class ElementNode extends Node {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = Object.create(null);
    this.style = new StyleDeclaration();
    this._value = '';
    this._checked = false;
    this._className = '';
  }

  setAttribute(name, value) {
    const key = String(name);
    this.attributes[key] = String(value);
    if (key === 'id' && this.ownerDocument) {
      this.ownerDocument._elementsById[String(value)] = this;
    }
    if (key === 'value') {
      this.value = value;
    }
    if (key === 'checked') {
      this.checked = value !== false && value != null;
    }
    if (key === 'class' || key === 'className') {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    const key = String(name);
    if (key === 'id' && this.ownerDocument) {
      const current = this.attributes[key];
      if (current && this.ownerDocument._elementsById[current] === this) {
        delete this.ownerDocument._elementsById[current];
      }
    }
    delete this.attributes[key];
    if (key === 'value') {
      this._value = '';
    }
    if (key === 'checked') {
      this._checked = false;
    }
    if (key === 'class' || key === 'className') {
      this.className = '';
    }
  }

  querySelector(selector) {
    return findMatchingNode(this, selector, true);
  }

  querySelectorAll(selector) {
    return findMatchingNode(this, selector, false);
  }

  addEventListener(type, listener) {
    super.addEventListener(type, listener);
  }

  get innerHTML() {
    return this.textContent;
  }

  set innerHTML(value) {
    this.childNodes = [];
    if (value && value.trim()) {
      this.appendChild(new TextNode(value));
    }
  }

  get value() {
    return this._value;
  }

  set value(next) {
    this._value = String(next ?? '');
  }

  get checked() {
    return !!this._checked;
  }

  set checked(value) {
    this._checked = Boolean(value);
  }

  get className() {
    return this._className;
  }

  set className(value) {
    const next = String(value || '');
    this._className = next;
    if (next) {
      this.attributes.class = next;
      this.attributes.className = next;
    } else {
      delete this.attributes.class;
      delete this.attributes.className;
    }
  }
}

class DocumentNode extends ElementNode {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.ownerDocument = this;
    this._elementsById = Object.create(null);
    this.documentElement = new ElementNode('html');
    this.documentElement.ownerDocument = this;
    super.appendChild(this.documentElement);
    this.body = new ElementNode('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  appendChild(node) {
    return this.documentElement.appendChild(node);
  }

  createElement(tag) {
    const el = new ElementNode(tag);
    el.ownerDocument = this;
    return el;
  }

  createTextNode(text) {
    const node = new TextNode(text);
    node.ownerDocument = this;
    return node;
  }

  createDocumentFragment() {
    const frag = new DocumentFragment();
    frag.ownerDocument = this;
    return frag;
  }

  createComment(data) {
    const comment = new CommentNode(data);
    comment.ownerDocument = this;
    return comment;
  }

  getElementById(id) {
    return this._elementsById[id] || null;
  }
}

class DomEvent {
  constructor(type, options = {}) {
    this.type = String(type);
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }
}

function installDom() {
  const document = new DocumentNode();
  const window = {
    document,
    Event: DomEvent,
    setTimeout: global.setTimeout.bind(global),
    clearTimeout: global.clearTimeout.bind(global),
    setInterval: global.setInterval.bind(global),
    clearInterval: global.clearInterval.bind(global)
  };

  document.defaultView = window;

  global.window = window;
  global.document = document;
  global.Node = Node;
  global.HTMLElement = ElementNode;
  global.Event = DomEvent;

  return window;
}

module.exports = { installDom };
