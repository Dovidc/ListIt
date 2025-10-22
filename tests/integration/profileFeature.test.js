const path = require('path');

const profileFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'profile.js'
);

function resetGlobals() {
  delete global.window;
  delete global.alert;
  delete global.document;
}

function loadFactory() {
  jest.resetModules();
  resetGlobals();
  global.window = { ListItApp: { features: {} } };
  global.document = { body: {} };
  global.alert = jest.fn();
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(profileFeaturePath);
  return global.window.ListItApp.features.profile.createProfileFeature;
}

function createReactMocks(stateOverrides = []) {
  const states = [];
  const React = {
    createElement: jest.fn((type, props = {}, ...children) => {
      const element = {
        type,
        props: {
          ...props,
          children: children.length <= 1 ? children[0] : children
        }
      };
      return element;
    }),
    memo: jest.fn((component) => component),
    Fragment: Symbol('Fragment'),
    useState: jest.fn((initial) => {
      const initialValue = typeof initial === 'function' ? initial() : initial;
      const override = stateOverrides.length ? stateOverrides.shift() : undefined;
      const record = {
        value: override !== undefined ? override : initialValue,
        setter: null
      };
      const setter = jest.fn((update) => {
        const resolved = typeof update === 'function' ? update(record.value) : update;
        record.value = resolved;
        return resolved;
      });
      record.setter = setter;
      states.push(record);
      return [record.value, setter];
    }),
    useCallback: jest.fn((fn) => fn)
  };

  return { React, states };
}

function collectNodes(node, nodes = []) {
  if (!node || typeof node !== 'object') {
    return nodes;
  }

  nodes.push(node);
  const props = node.props || {};
  const { children } = props;

  if (typeof node.type === 'function') {
    const rendered = node.type(props);
    if (rendered) {
      collectNodes(rendered, nodes);
    }
  }

  if (Array.isArray(children)) {
    children.forEach((child) => collectNodes(child, nodes));
  } else if (children && typeof children === 'object') {
    collectNodes(children, nodes);
  }

  return nodes;
}

describe('profile feature integration', () => {
  afterEach(() => {
    resetGlobals();
  });

  test('registers factory and enforces dependency contract', () => {
    const createProfileFeature = loadFactory();

    expect(typeof createProfileFeature).toBe('function');
    expect(() => createProfileFeature({})).toThrow('Profile feature requires React.');

    const React = { createElement: () => {} };
    expect(() => createProfileFeature({ React })).toThrow('Profile feature requires ReactDOM.');

    const ReactDOM = { createPortal: jest.fn() };
    expect(() => createProfileFeature({ React, ReactDOM })).toThrow('Profile feature requires an API client.');

    const api = {};
    expect(() => createProfileFeature({ React, ReactDOM, api })).toThrow('Profile feature requires asArray helper.');

    const helpers = { asArray: () => [] };
    expect(() => createProfileFeature({ React, ReactDOM, api, helpers })).toThrow('Profile feature requires ImageWithSkeleton component.');
  });

  test('ProfilePanel wires feature toggles, persistence, and listing actions', async () => {
    const createProfileFeature = loadFactory();
    const { React, states } = createReactMocks([undefined, undefined, true, true, undefined, 'updated@example.com']);

    const api = {
      updatePaypalEmail: jest.fn().mockResolvedValue({}),
      me: jest.fn().mockResolvedValue({ id: 'me-2' })
    };
    const helpers = {
      asArray: jest.fn((value) => (Array.isArray(value) ? value : value == null ? [] : [value]))
    };
    const components = {
      ImageWithSkeleton: jest.fn(),
      InfoHelpModal: jest.fn(),
      AutoListHelpModal: jest.fn(),
      AiDescriptionHelpModal: jest.fn(),
      ListingModal: jest.fn()
    };
    const appNav = { setUser: jest.fn() };

    const ReactDOM = { createPortal: jest.fn((node) => node) };
    const feature = createProfileFeature({ React, ReactDOM, api, helpers, components, appNav });
    const { ProfilePanel } = feature;

    const props = {
      isMobile: true,
      user: { id: 'user-1', email: 'user@example.com', paypal_email: 'initial@example.com' },
      items: [
        { id: 1, sold: false, image_data: 'img-1' },
        { id: 2, sold: true, image_data: 'img-2' }
      ],
      onNewListing: jest.fn(),
      onEdit: jest.fn(),
      onDelete: jest.fn().mockResolvedValue(undefined),
      onLogout: jest.fn(),
      onAdminDelete: jest.fn().mockResolvedValue(undefined),
      autoListEnabled: false,
      setAutoListEnabled: jest.fn(),
      aiDescriptionEnabled: false,
      setAiDescriptionEnabled: jest.fn(),
      autoPostNearbyEnabled: false,
      setAutoPostNearbyEnabled: jest.fn(),
      onViewSeller: jest.fn(),
      onToggleSold: jest.fn()
    };

    const tree = ProfilePanel(props);
    const nodes = collectNodes(tree);

    const paypalPresetButton = nodes.find((node) => node?.props?.title === 'Manage PayPal preset');
    expect(paypalPresetButton).toBeDefined();
    states[3].setter.mockClear();
    paypalPresetButton.props.onClick();
    expect(states[3].setter).toHaveBeenCalledWith(true);

    expect(helpers.asArray).toHaveBeenNthCalledWith(1, props.items);
    expect(helpers.asArray).toHaveBeenNthCalledWith(2, props.items);

    const checkboxes = nodes.filter((node) => node?.props?.type === 'checkbox');
    expect(checkboxes).toHaveLength(3);

    checkboxes[0].props.onChange({ target: { checked: true } });
    expect(props.setAutoListEnabled).toHaveBeenCalledWith(true);

    checkboxes[1].props.onChange({ target: { checked: true } });
    expect(props.setAiDescriptionEnabled).toHaveBeenCalledWith(true);

    checkboxes[2].props.onChange({ target: { checked: true } });
    expect(props.setAutoPostNearbyEnabled).toHaveBeenCalledWith(true);

    const newListingButton = nodes.find((node) => node?.props?.children === 'New listing');
    newListingButton.props.onClick();
    expect(props.onNewListing).toHaveBeenCalledTimes(1);

    const logoutButton = nodes.find((node) => node?.props?.children === 'Log out');
    logoutButton.props.onClick();
    expect(props.onLogout).toHaveBeenCalledTimes(1);

    const paypalSaveButton = nodes.find((node) => node?.props?.children === 'Save');
    await paypalSaveButton.props.onClick();
    expect(api.updatePaypalEmail).toHaveBeenCalledWith('updated@example.com');
    expect(api.me).toHaveBeenCalledWith({ silent: true });
    expect(appNav.setUser).toHaveBeenCalledWith({ id: 'me-2' });
    expect(global.alert).toHaveBeenCalledWith('Saved.');

    const listingModal = nodes.find((node) => node?.type === components.ListingModal);
    expect(listingModal).toBeDefined();
    const { cardProps, onClose } = listingModal.props;
    expect(cardProps.onToggleSold).toBe(props.onToggleSold);
    expect(cardProps.onViewSeller).toBe(props.onViewSeller);

    states[1].setter.mockClear();
    cardProps.onEdit(props.items[0]);
    expect(props.onEdit).toHaveBeenCalledWith(props.items[0]);
    expect(states[1].setter).toHaveBeenCalledWith(null);

    states[1].setter.mockClear();
    await cardProps.onDelete(props.items[1]);
    expect(props.onDelete).toHaveBeenCalledWith(props.items[1]);
    expect(states[1].setter).toHaveBeenCalledWith(null);

    states[1].setter.mockClear();
    await cardProps.onAdminDelete(42);
    expect(props.onAdminDelete).toHaveBeenCalledWith(42);
    expect(states[1].setter).toHaveBeenCalledWith(null);

    states[1].setter.mockClear();
    onClose();
    expect(states[1].setter).toHaveBeenCalledWith(null);
  });

  test('omits nearby auto-post toggle on desktop', () => {
    const createProfileFeature = loadFactory();
    const { React } = createReactMocks([undefined, undefined, true]);

    const api = {
      updatePaypalEmail: jest.fn().mockResolvedValue({}),
      me: jest.fn().mockResolvedValue({ id: 'me-3' })
    };

    const helpers = {
      asArray: jest.fn((value) => (Array.isArray(value) ? value : value == null ? [] : [value]))
    };

    const components = {
      ImageWithSkeleton: jest.fn(),
      InfoHelpModal: jest.fn(),
      AutoListHelpModal: jest.fn(),
      AiDescriptionHelpModal: jest.fn(),
      ListingModal: jest.fn()
    };

    const ReactDOM = { createPortal: jest.fn((node) => node) };
    const feature = createProfileFeature({ React, ReactDOM, api, helpers, components, appNav: { setUser: jest.fn() } });
    const { ProfilePanel } = feature;

    const props = {
      isMobile: false,
      user: { id: 'user-2', email: 'desktop@example.com' },
      items: [],
      onNewListing: jest.fn(),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onLogout: jest.fn(),
      onAdminDelete: jest.fn(),
      autoListEnabled: false,
      setAutoListEnabled: jest.fn(),
      aiDescriptionEnabled: false,
      setAiDescriptionEnabled: jest.fn(),
      autoPostNearbyEnabled: false,
      setAutoPostNearbyEnabled: jest.fn(),
      onViewSeller: jest.fn(),
      onToggleSold: jest.fn()
    };

    const tree = ProfilePanel(props);
    const nodes = collectNodes(tree);

    const checkboxes = nodes.filter((node) => node?.props?.type === 'checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(nodes.some((node) => typeof node?.props?.children === 'string' && node.props.children === 'Auto Nearby')).toBe(false);
  });
});
