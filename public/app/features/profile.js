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
      ListingModal
    } = components;

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

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const {
      useState,
      useCallback
    } = React;
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
      H('rect', {
        x: 3.2,
        y: 4,
        width: 17.6,
        height: 16,
        rx: 2.2,
        ry: 2.2
      }),
      H('path', { d: 'M7.5 9.5h9' }),
      H('path', { d: 'M7.5 13h5.5' }),
      H('polyline', { points: '15.5 12.2 17 13.8 19 11.2' }));
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
      onSavePaypal
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
                  margin: 0
                }
              }, 'PayPal preset'),
              H('p', {
                className: 'muted',
                style: { fontSize: 13, margin: 0 }
              }, 'Save the PayPal email you want to share when you use the preset in messages.')
            ),
            H('label', { style: { display: 'grid', gap: 8 } },
              H('span', { style: { fontWeight: 600 } }, 'PayPal email'),
              H('input', {
                value: paypalEmail,
                onChange: (evt) => onChangePaypalEmail?.(evt.target.value),
                placeholder: 'name@example.com',
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
            H('p', {
              className: 'muted',
              style: { fontSize: 12, margin: 0 }
            }, 'When you press "Reveal PayPal address" in a DM, the email you save here will be sent as a normal message.')
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
        setPaypalModalOpen(true);
      }, []);

      const handleClosePaypalModal = useCallback(() => {
        setPaypalModalOpen(false);
      }, []);

      const [profileTab, setProfileTab] = useState('active');
      const [paypalEmail, setPaypalEmail] = useState(user?.paypal_email || '');

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

      async function savePaypal() {
        const r = await api.updatePaypalEmail((paypalEmail || '').trim());
        if (r?.error) { alert(r.error); return; }
        const me = await api.me({ silent: true });
        navBridge.setUser?.(me);
        const nextPaypalEmail = r?.paypal_email ?? (paypalEmail || '').trim();
        setPaypalEmail(nextPaypalEmail);
        setPaypalModalOpen(false);
        alert('Saved.');
      }

      if (!user) {
        return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
          H('div', { className: 'muted' }, 'Please log in to view your profile.')
        );
      }

      const activeItems = asArray(items).filter(it => !it?.sold);
      const soldItems = asArray(items).filter(it => !!it?.sold);
      const shownItems = profileTab === 'sold' ? soldItems : activeItems;
      const paypalSummary = (paypalEmail || '').trim();

      return H(React.Fragment, null,
        H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
            H('div', null,
              H('div', { style: { fontWeight: 800, fontSize: 18 } }, user.username ? `@${user.username}` : user.email),
              H('div', { className: 'muted' }, 'Your account')
            ),
            H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: handleOpenPaypalModal,
                title: 'Manage PayPal preset',
                style: iconButtonStyle
              },
                H(PresetIcon, null),
                H('span', { style: visuallyHidden }, 'Manage PayPal preset')
              ),
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: handleOpenSettings,
                title: 'Profile settings',
                style: iconButtonStyle
              },
                H(SettingsIcon, null),
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
                H('span', { style: visuallyHidden }, 'Log out')
              )
            )
          ),

          H('section', null,
            H('div', {
              className: 'muted',
              style: { fontSize: 12, margin: '12px 0 16px' }
            }, paypalSummary
              ? `Current PayPal email: ${paypalSummary}`
              : 'No PayPal email saved yet. Use the preset icon above to add one.'),
            H('div', {
              className: 'row',
              style: { justifyContent: 'space-between', margin: '0 0 12px', flexWrap: 'wrap', alignItems: 'center' }
            },
              H('div', { style: { fontWeight: 800 } }, 'Your listings'),
              H('div', { className: 'muted' }, `Active ${activeItems.length} - Sold ${soldItems.length}`)
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
              ? (() => {
                  const COLS = isMobile ? 3 : 4;
                  const GAP = 12;
                  return H('section', {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                      gap: GAP
                    }
                  },
                    shownItems.map(it => {
                      const src = it.image_data || '';
                      return H('div', {
                        key: it.id,
                        className: 'card',
                        style: { padding: 0, overflow: 'hidden', borderRadius: 8, cursor: 'pointer' },
                        onClick: () => setProfileSelected(it)
                      },
                        H('div', {
                          style: {
                            position: 'relative',
                            width: '100%',
                            aspectRatio: '1 / 1',
                            background: '#f3f4f6'
                          }
                        },
                          src ? H(ImageWithSkeleton, {
                            src,
                            alt: it.title || 'Item',
                            loading: 'lazy',
                            decoding: 'async',
                            fetchPriority: 'low',
                            style: {
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              display: 'block'
                            },
                            disableSkeleton: true
                          }) : H('div', {
                            style: {
                              position: 'absolute',
                              inset: 0,
                              display: 'grid',
                              placeItems: 'center',
                              color: '#6b7280',
                              fontWeight: 600
                            }
                          }, 'No image'),
                          it.sold ? H('div', {
                            style: {
                              position: 'absolute',
                              top: '22%',
                              left: '50%',
                              transform: 'translateX(-50%) rotate(-12deg)',
                              background: 'rgba(5, 150, 105, 0.92)',
                              color: '#fff',
                              fontWeight: 800,
                              fontSize: 20,
                              letterSpacing: 4,
                              textTransform: 'uppercase',
                              padding: '6px 24px',
                              borderRadius: 999,
                              pointerEvents: 'none',
                              boxShadow: '0 8px 18px rgba(4,120,87,0.35)'
                            }
                          }, 'Sold') : null
                        )
                      );
                    })
                  );
                })()
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
          onChangePaypalEmail: setPaypalEmail,
          onSavePaypal: savePaypal
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
          isMobile
        }),

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
