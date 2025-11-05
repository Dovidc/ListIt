(() => {
  function createProfileFeature({
    React,
    ReactDOM,
    api,
    helpers = {},
    components = {},
    appNav
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Profile feature requires React.');
    }
    const resolvedReactDOM = ReactDOM || (typeof window !== 'undefined' ? window.ReactDOM : null);
    if (!resolvedReactDOM || typeof resolvedReactDOM.createPortal !== 'function') {
      throw new Error('Profile feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Profile feature requires an API client.');
    }

    const { asArray } = helpers;
    if (typeof asArray !== 'function') {
      throw new Error('Profile feature requires asArray helper.');
    }

    const {
      ImageWithSkeleton,
      InfoHelpModal,
      AutoListHelpModal,
      AiDescriptionHelpModal,
      ListingModal,
      ProfilePictureUploadModal,
      ListingsGrid
    } = components;

    console.log('Profile feature received components:', components);
    console.log('ListingsGrid in profile:', ListingsGrid, typeof ListingsGrid);
    console.log('ListingsGrid keys:', ListingsGrid ? Object.keys(ListingsGrid) : 'undefined');
    console.log('Is ListingsGrid a React component?', ListingsGrid?.$$typeof);

    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Profile feature requires ImageWithSkeleton component.');
    }
    if (typeof InfoHelpModal !== 'function') {
      throw new Error('Profile feature requires InfoHelpModal component.');
    }
    if (typeof AutoListHelpModal !== 'function') {
      throw new Error('Profile feature requires AutoListHelpModal component.');
    }
    if (typeof AiDescriptionHelpModal !== 'function') {
      throw new Error('Profile feature requires AiDescriptionHelpModal component.');
    }
    if (typeof ListingModal !== 'function') {
      throw new Error('Profile feature requires ListingModal component.');
    }
    // ListingsGrid is optional - we'll fall back to custom rendering if not available

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const {
      useState,
      useCallback,
      useRef: reactUseRef
    } = React;
    const useEffect = typeof React.useEffect === 'function' ? React.useEffect : null;
    const useRef = typeof reactUseRef === 'function' ? reactUseRef : ((initial) => ({ current: initial }));
    const { createPortal } = resolvedReactDOM;

    const navBridge = appNav || { setUser: () => {} };

    const iconButtonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      padding: 0
    };

    function SettingsIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
      H('path', {
        d: 'M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.17a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.17a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.33h.17A1.7 1.7 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.17a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82v.17a1.7 1.7 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.17a1.7 1.7 0 0 0-1.51 1z'
      }),
      H('circle', { cx: 12, cy: 12, r: 3.2 }));
    }

    function LogoutIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
      H('path', { d: 'M14 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5' }),
      H('polyline', { points: '9 8 4 12 9 16' }),
      H('line', { x1: 4, y1: 12, x2: 16, y2: 12 }));
    }

    function PresetIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
      H('line', { x1: 4, y1: 6.5, x2: 20, y2: 6.5 }),
      H('line', { x1: 4, y1: 12, x2: 20, y2: 12 }),
      H('line', { x1: 4, y1: 17.5, x2: 20, y2: 17.5 }),
      H('circle', { cx: 9, cy: 6.5, r: 2.1, fill: 'currentColor', stroke: 'none' }),
      H('circle', { cx: 15.5, cy: 12, r: 2.1, fill: 'currentColor', stroke: 'none' }),
      H('circle', { cx: 7.5, cy: 17.5, r: 2.1, fill: 'currentColor', stroke: 'none' }));
    }

    function PaypalPresetIcon(props = {}) {
      const { size = 22, stroke = 'currentColor', style, ...rest } = props;
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
      H('rect', { x: 3.2, y: 7.6, width: 17.6, height: 11.6, rx: 2.8, ry: 2.8 }),
      H('path', { d: 'M6.2 7.6V6.1c0-2 1.6-3.6 3.6-3.6h8.2a1.8 1.8 0 0 1 0 3.6H6.2' }),
      H('path', { d: 'M10.8 11.2h2.3a1.9 1.9 0 0 1 0 3.8h-2.3V18' }),
      H('path', { d: 'M10.8 15h1.8' }),
      H('circle', { cx: 16.8, cy: 13.4, r: 1.5 }));
    }

    function LocationPresetIcon(props = {}) {
      const { size = 22, stroke = 'currentColor', style, ...rest } = props;
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
      H('path', { d: 'M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11z' }),
      H('circle', { cx: 12, cy: 10, r: 2.6 }));
    }

    const AutoPostNearbyHelpModal = React.memo(function AutoPostNearbyHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Auto-post to Nearby',
        intro: 'When enabled, Auto-List will also publish your item to the Nearby feed.',
        bullets: [
          'Uses your latest saved location to set latitude and longitude.',
          'Marks the new listing as available to nearby shoppers.',
          'Requires Auto-List to be turned on and is best used from your phone.'
        ],
        footer: 'You can always edit the listing afterwards to adjust its location or disable Nearby.'
      });
    });

    const InquiryHelpModal = React.memo(function InquiryHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Inquiry mode',
        intro: 'When inquiry is enabled it will:',
        bullets: [
          'Replace the price field with a message inviting buyers to make an offer.'
        ],
        footer: 'Turn inquiry mode off to show the AI suggested price again.'
      });
    });

    const PaypalPresetModal = React.memo(function PaypalPresetModal({
      open,
      onClose,
      paypalEmail,
      onChangePaypalEmail,
      onSavePaypal,
      statusMessage,
      locationPreset,
      onChangeLocationPreset,
      onSaveLocation,
      locationStatusMessage
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '460px',
              width: 'min(460px, 92vw)',
              padding: '24px',
              background: '#fff',
              color: '#111',
              borderRadius: 16,
              display: 'grid',
              gap: 16
            }
          },
            H('button', {
              className: 'close',
              onClick: onClose,
              title: 'Close preset settings'
            }, 'x'),
            H('div', { style: { display: 'grid', gap: 8 } },
              H('h2', {
                style: {
                  fontSize: 20,
                  fontWeight: 800,
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }
              },
              'Payment preset',
              H(PaypalPresetIcon, { size: 22 })
            ),
              H('p', {
                className: 'muted',
                style: { fontSize: 13, margin: 0 }
              }, 'Save the payment and address info you want to share when you use the preset in messages.')
            ),
            H('section', { style: { display: 'grid', gap: 12 } },
              H('label', { style: { display: 'grid', gap: 8 } },
                H('span', { style: { fontWeight: 600 } }, 'Payment info'),
                H('input', {
                  value: paypalEmail,
                  onChange: (evt) => onChangePaypalEmail?.(evt.target.value),
                  placeholder: 'name@example.com',
                  maxLength: 240,
                  style: { width: '100%' }
                })
              ),
              H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end'
                }
              },
                H('button', {
                  className: 'btn primary',
                  type: 'button',
                  onClick: onSavePaypal
                }, 'Save')
              ),
              statusMessage && H('div', {
                role: 'status',
                'aria-live': 'polite',
                style: {
                  fontSize: 13,
                  color: '#047857',
                  fontWeight: 600
                }
              }, statusMessage)
            ),
            H('section', { style: { display: 'grid', gap: 12 } },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }
              },
                H('span', { style: { fontWeight: 600 } }, 'Saved address'),
                H(LocationPresetIcon, { size: 18 })
              ),
              H('textarea', {
                value: locationPreset,
                onChange: (evt) => onChangeLocationPreset?.(evt.target.value),
                placeholder: '123 Main St, City, State',
                rows: 3,
                style: { width: '100%', resize: 'vertical' }
              }),
              H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end'
                }
              },
                H('button', {
                  className: 'btn primary',
                  type: 'button',
                  onClick: onSaveLocation
                }, 'Save')
              ),
              locationStatusMessage && H('div', {
                role: 'status',
                'aria-live': 'polite',
                style: {
                  fontSize: 13,
                  color: '#047857',
                  fontWeight: 600
                }
              }, locationStatusMessage)
            ),
            H('p', {
              className: 'muted',
              style: { fontSize: 12, margin: 0 }
            }, 'When you press the preset icon in a conversation, the info you save here will be sent as a normal message.')
          )
        ),
        document.body
      );
    });

    const ProfileSettingsModal = React.memo(function ProfileSettingsModal({
      open,
      onClose,
      onRequestHelp,
      autoListEnabled,
      setAutoListEnabled,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      aiDescriptionEnabled,
      setAiDescriptionEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      onRequestDeleteAccount,
      isMobile
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const requestHelp = (topic) => {
        if (typeof onRequestHelp === 'function') {
          onRequestHelp(topic);
        }
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '520px',
              width: 'min(520px, 92vw)',
              padding: '24px',
              background: '#fff',
              color: '#111',
              borderRadius: 16
            }
          },
            H('button', {
              className: 'close',
              onClick: onClose,
              title: 'Close settings'
            }, 'x'),
            H('div', { style: { display: 'grid', gap: 12 } },
              H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoListEnabled,
                  onChange: (e) => {
                    const checked = e.target.checked;
                    setAutoListEnabled?.(checked);
                    if (checked && typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(true);
                    }
                    if (!checked && typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(false);
                    }
                  }
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Auto-list'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'new uploads')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('auto'); },
                  title: 'About Auto-list',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              autoListEnabled && H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoInquiryEnabled,
                  onChange: (e) => {
                    if (typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(e.target.checked);
                    }
                  }
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Inquiry text'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'replace price with offer line')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('inquiry'); },
                  title: 'Inquiry mode info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!aiDescriptionEnabled,
                  onChange: (e) => setAiDescriptionEnabled?.(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'AI descriptions'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'fill description for you')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('ai'); },
                  title: 'AI description tips',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              isMobile && H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoPostNearbyEnabled,
                  onChange: (e) => setAutoPostNearbyEnabled?.(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Auto Nearby'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'auto-list extra option')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('nearby'); },
                  title: 'Nearby auto-post info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              H('div', {
                style: {
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: '1px solid #e5e7eb'
                }
              },
                H('div', { style: { fontWeight: 700, marginBottom: 8, color: '#dc2626' } }, 'Danger Zone'),
                H('button', {
                  className: 'btn',
                  onClick: onRequestDeleteAccount,
                  style: {
                    width: '100%',
                    background: '#dc2626',
                    color: 'white',
                    border: 'none'
                  }
                }, 'Delete Account')
              )
            )
          )
        ),
        document.body
      );
    });

    const ProfilePanel = React.memo(function ProfilePanel({
      isMobile,
      user,
      items,
      onEnsureCover,
      onEdit,
      onDelete,
      onLogout,
      onAdminDelete,
      autoListEnabled,
      setAutoListEnabled,
      aiDescriptionEnabled,
      setAiDescriptionEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      onViewSeller,
      onToggleSold
    }) {
      const [helpModal, setHelpModal] = useState(null);
      const [profileSelected, setProfileSelected] = useState(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [paypalModalOpen, setPaypalModalOpen] = useState(false);
      const [paypalStatusMessage, setPaypalStatusMessage] = useState('');
      const [locationStatusMessage, setLocationStatusMessage] = useState('');
      const [profilePictureModalOpen, setProfilePictureModalOpen] = useState(false);
      const [profilePictureUrl, setProfilePictureUrl] = useState(user?.profile_picture_url || '');
      const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
      const [deleteConfirmText, setDeleteConfirmText] = useState('');
      const [deleteAccountError, setDeleteAccountError] = useState('');

      useEffect(() => {
        if (!user) return;
        const url = user.profile_picture_url || '';
        console.log('Profile picture URL from user:', url);
        console.log('Full user object:', user);

        // Only update state if user object has the profile_picture_url property
        // This prevents overwriting with empty string when user object is being updated
        if ('profile_picture_url' in user) {
          setProfilePictureUrl(url);
        }
      }, [user]);

      const handleEdit = useCallback((it) => {
        setProfileSelected(null);
        onEdit?.(it);
      }, [onEdit]);

      const handleDelete = useCallback(async (it) => {
        if (onDelete) await onDelete(it);
        setProfileSelected(null);
      }, [onDelete]);

      const handleAdminDelete = useCallback(async (id) => {
        if (onAdminDelete) await onAdminDelete(id);
        setProfileSelected(null);
      }, [onAdminDelete]);

      const handleOpenSettings = useCallback(() => {
        setSettingsOpen(true);
      }, []);

      const handleCloseSettings = useCallback(() => {
        setSettingsOpen(false);
        setHelpModal(null);
      }, [setHelpModal]);

      const handleOpenPaypalModal = useCallback(() => {
        setPaypalStatusMessage('');
        setLocationStatusMessage('');
        setPaypalModalOpen(true);
      }, []);

      const handleClosePaypalModal = useCallback(() => {
        setPaypalModalOpen(false);
        setPaypalStatusMessage('');
        setLocationStatusMessage('');
      }, []);

      const [profileTab, setProfileTab] = useState('active');
      const [paypalEmailState, setPaypalEmailState] = useState(user?.paypal_email || '');
      const paypalEmailRef = useRef(paypalEmailState);
      const setPaypalEmail = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(paypalEmailRef.current) : value;
        paypalEmailRef.current = resolved;
        setPaypalEmailState(resolved);
      }, [paypalEmailRef, setPaypalEmailState]);
      const paypalEmail = paypalEmailState;
      const [locationPresetState, setLocationPresetState] = useState(user?.location_preset || '');
      const locationPresetRef = useRef(locationPresetState);
      const setLocationPreset = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(locationPresetRef.current) : value;
        locationPresetRef.current = resolved;
        setLocationPresetState(resolved);
      }, [locationPresetRef, setLocationPresetState]);
      const locationPreset = locationPresetState;
      const visuallyHidden = {
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0
      };
      const handleChangePaypalEmail = useCallback((value) => {
        setPaypalEmail(value);
        if (paypalStatusMessage) {
          setPaypalStatusMessage('');
        }
      }, [paypalStatusMessage]);

      const handleChangeLocationPreset = useCallback((value) => {
        setLocationPreset(value);
        if (locationStatusMessage) {
          setLocationStatusMessage('');
        }
      }, [locationStatusMessage]);
      async function savePaypal() {
        const trimmed = (paypalEmailRef.current || '').trim();
        let response;
        try {
          response = await api.updatePaypalEmail(trimmed);
        } catch (err) {
          alert(err?.message || 'Failed to save PayPal preset.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextPaypalEmail = typeof response?.paypal_email === 'string' ? response.paypal_email : trimmed;
        setPaypalEmail(nextPaypalEmail);
        if (user) {
          navBridge.setUser?.({ ...user, paypal_email: nextPaypalEmail });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setPaypalStatusMessage('Saved');
      }

      async function saveLocationPreset() {
        const trimmed = (locationPresetRef.current || '').trim();
        let response;
        try {
          if (typeof api.updateLocationPreset !== 'function') {
            throw new Error('updateLocationPreset unavailable');
          }
          response = await api.updateLocationPreset(trimmed);
        } catch (err) {
          alert(err?.message || 'Failed to save address preset.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextLocation = typeof response?.location_preset === 'string' ? response.location_preset : trimmed;
        setLocationPreset(nextLocation);
        if (user) {
          navBridge.setUser?.({ ...user, location_preset: nextLocation });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setLocationStatusMessage('Saved');
      }

      const handleOpenProfilePictureModal = useCallback(() => {
        setProfilePictureModalOpen(true);
      }, []);

      const handleCloseProfilePictureModal = useCallback(() => {
        setProfilePictureModalOpen(false);
      }, []);

      const handleProfilePictureUploadComplete = useCallback(async (url) => {
        setProfilePictureUrl(url);
        // Refresh user data
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
      }, []);

      const handleRequestDeleteAccount = useCallback(() => {
        setSettingsOpen(false);
        setDeleteAccountModalOpen(true);
        setDeleteConfirmText('');
        setDeleteAccountError('');
      }, []);

      const handleCloseDeleteAccountModal = useCallback(() => {
        setDeleteAccountModalOpen(false);
        setDeleteConfirmText('');
        setDeleteAccountError('');
      }, []);

      const handleDeleteAccount = useCallback(async () => {
        if (deleteConfirmText !== 'confirm') {
          setDeleteAccountError('Please type "confirm" to delete your account');
          return;
        }

        try {
          await api.deleteAccount('confirm');
          // Account deleted, user is logged out
          onLogout?.();
        } catch (err) {
          console.error('Delete account failed:', err);
          setDeleteAccountError(err.message || 'Failed to delete account');
        }
      }, [deleteConfirmText, onLogout]);

      if (!user) {
        return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
          H('div', { className: 'muted' }, 'Please log in to view your profile.')
        );
      }

      const activeItems = asArray(items).filter(it => !it?.sold);
      const soldItems = asArray(items).filter(it => !!it?.sold);
      const shownItems = profileTab === 'sold' ? soldItems : activeItems;
      return H(React.Fragment, null,
        H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
            H('div', { className: 'row', style: { gap: 12, alignItems: 'center' } },
              H('div', {
                className: 'profile-avatar',
                onClick: handleOpenProfilePictureModal,
                style: { cursor: 'pointer' },
                title: 'Click to change profile picture'
              },
                (profilePictureUrl && profilePictureUrl.trim())
                  ? H('img', {
                      src: profilePictureUrl,
                      alt: 'Profile picture',
                      onError: (e) => {
                        console.error('Failed to load profile picture:', profilePictureUrl);
                        e.target.style.display = 'none';
                      },
                      onLoad: () => {
                        console.log('Profile picture loaded successfully:', profilePictureUrl);
                      }
                    })
                  : (user.username ? user.username.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase())
              ),
              H('div', null,
                H('div', { style: { fontWeight: 800, fontSize: 18 } },
                  user.username ? `@${user.username}` : user.email
                ),
                H('div', { className: 'muted', style: { marginTop: 4 } }, 'Your account')
              )
            ),
            H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: handleOpenPaypalModal,
                title: 'Manage payment preset',
                style: iconButtonStyle
              },
                H(SettingsIcon, null),
                H('span', { style: visuallyHidden }, 'Manage payment preset')
              ),
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: handleOpenSettings,
                title: 'Profile settings',
                style: iconButtonStyle
              },
                H(PresetIcon, null),
                H('span', { style: visuallyHidden }, 'Open profile settings')
              ),
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: onLogout,
                title: 'Log out',
                style: iconButtonStyle
              },
                H(LogoutIcon, null),
                H('span', { style: visuallyHidden, onClick: onLogout }, 'Log out')
              )
            )
          ),

        H('section', null,
          H('div', {
            className: 'row',
            style: { justifyContent: 'space-between', margin: '0 0 12px', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
          },
            H('div', { style: { fontWeight: 800 } }, 'Your listings'),
            H('div', {
              className: 'row',
              style: { gap: 8, alignItems: 'center', flexWrap: 'wrap' }
            },
              H('div', { className: 'muted' }, `Active ${activeItems.length} - Sold ${soldItems.length}`)
            )
          ),
          H('div', { className: 'row', style: { gap: 8, margin: '0 0 16px' } },
            H('button', {
              className: `btn ${profileTab === 'active' ? 'primary' : ''}`,
              type: 'button',
              onClick: () => setProfileTab('active')
            }, 'Active listings'),
            H('button', {
              className: `btn ${profileTab === 'sold' ? 'primary' : ''}`,
              type: 'button',
              onClick: () => setProfileTab('sold')
            }, 'Sold listings')
          ),
          (shownItems.length
            ? (ListingsGrid
                ? H(ListingsGrid, {
                    items: shownItems,
                    onEnsureCover: onEnsureCover,
                    onSelect: (evt, item) => setProfileSelected(item),
                    columns: isMobile ? 3 : 4
                  })
                : H('div', { style: { padding: 16 } }, 'ListingsGrid component not available')
              )
              : H('p', {
                  className: 'muted',
                  style: { textAlign: 'center', margin: '28px 0' }
                }, profileTab === 'sold' ? 'No sold listings yet.' : 'No listings yet. Create your first one!')
            )
          )
        ),

        helpModal === 'auto' && H(AutoListHelpModal, { onClose: () => setHelpModal(null) }),
        helpModal === 'ai' && H(AiDescriptionHelpModal, { onClose: () => setHelpModal(null) }),
        helpModal === 'nearby' && H(AutoPostNearbyHelpModal, { onClose: () => setHelpModal(null) }),
        helpModal === 'inquiry' && H(InquiryHelpModal, { onClose: () => setHelpModal(null) }),

        H(PaypalPresetModal, {
          open: paypalModalOpen,
          onClose: handleClosePaypalModal,
          paypalEmail,
          onChangePaypalEmail: handleChangePaypalEmail,
          onSavePaypal: savePaypal,
          statusMessage: paypalStatusMessage,
          locationPreset,
          onChangeLocationPreset: handleChangeLocationPreset,
          onSaveLocation: saveLocationPreset,
          locationStatusMessage: locationStatusMessage
        }),

        H(ProfileSettingsModal, {
          open: settingsOpen,
          onClose: handleCloseSettings,
          onRequestHelp: setHelpModal,
          autoListEnabled,
          setAutoListEnabled,
          autoInquiryEnabled,
          setAutoInquiryEnabled,
          aiDescriptionEnabled,
          setAiDescriptionEnabled,
          autoPostNearbyEnabled,
          setAutoPostNearbyEnabled,
          onRequestDeleteAccount: handleRequestDeleteAccount,
          isMobile
        }),

        H(ProfilePictureUploadModal, {
          open: profilePictureModalOpen,
          onClose: handleCloseProfilePictureModal,
          onUploadComplete: handleProfilePictureUploadComplete,
          currentPictureUrl: profilePictureUrl
        }),

        deleteAccountModalOpen && createPortal(
          H('div', {
            className: 'modal-overlay',
            onClick: (e) => {
              if (e.target.classList.contains('modal-overlay')) {
                handleCloseDeleteAccountModal();
              }
            }
          },
            H('div', { className: 'modal-content', style: { maxWidth: 400 } },
              H('div', { className: 'modal-header' },
                H('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Delete Account'),
                H('button', {
                  className: 'modal-close',
                  onClick: handleCloseDeleteAccountModal,
                  'aria-label': 'Close'
                }, '×')
              ),
              H('div', { className: 'modal-body' },
                H('p', { style: { marginBottom: 16 } },
                  'This action cannot be undone. All your listings, messages, and account data will be permanently deleted.'
                ),
                H('p', { style: { marginBottom: 16, fontWeight: 600 } },
                  'Type "confirm" to delete your account:'
                ),
                H('input', {
                  type: 'text',
                  value: deleteConfirmText,
                  onChange: (e) => setDeleteConfirmText(e.target.value),
                  placeholder: 'Type confirm',
                  style: {
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    fontSize: 14,
                    marginBottom: 12
                  }
                }),
                deleteAccountError && H('div', {
                  style: {
                    padding: 12,
                    background: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: 8,
                    marginBottom: 12
                  }
                }, deleteAccountError),
                H('div', { style: { display: 'flex', gap: 8 } },
                  H('button', {
                    className: 'btn',
                    onClick: handleCloseDeleteAccountModal,
                    style: { flex: 1 }
                  }, 'Cancel'),
                  H('button', {
                    className: 'btn',
                    onClick: handleDeleteAccount,
                    disabled: deleteConfirmText !== 'confirm',
                    style: {
                      flex: 1,
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      opacity: deleteConfirmText !== 'confirm' ? 0.5 : 1
                    }
                  }, 'Delete Account')
                )
              )
            )
          ),
          document.body
        ),

        H(ListingModal, {
          open: !!profileSelected,
          item: profileSelected,
          onClose: () => setProfileSelected(null),
          cardProps: {
            user,
            canEdit: true,
            onEdit: handleEdit,
            onDelete: handleDelete,
            onAdminDelete: handleAdminDelete,
            onViewSeller,
            onToggleSold,
            showDistance: false
          }
        })
      );
    });

    return {
      ProfilePanel
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.profile = {
    createProfileFeature
  };
})();
