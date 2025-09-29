(() => {
  function createProfileFeature({
    React,
    api,
    helpers = {},
    components = {},
    appNav
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Profile feature requires React.');
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

    const navBridge = appNav || { setUser: () => {} };

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

    const ProfilePanel = React.memo(function ProfilePanel({
      isMobile,
      user,
      items,
      onNewListing,
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

      const [profileTab, setProfileTab] = useState('active');
      const [paypalEmail, setPaypalEmail] = useState(user?.paypal_email || '');

      async function savePaypal() {
        const r = await api.updatePaypalEmail((paypalEmail || '').trim());
        if (r?.error) { alert(r.error); return; }
        const me = await api.me({ silent: true });
        navBridge.setUser?.(me);
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

      return H(React.Fragment, null,
        H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
            H('div', null,
              H('div', { style: { fontWeight: 800, fontSize: 18 } }, user.username ? `@${user.username}` : user.email),
              H('div', { className: 'muted' }, 'Your account')
            ),
            H('div', { className: 'row', style: { gap: 12, alignItems: 'center', flexWrap: 'wrap' } },
              H('label', { className: 'toggle-card', style: { padding: '6px 10px' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoListEnabled,
                  onChange: (e) => {
                    const checked = e.target.checked;
                    setAutoListEnabled(checked);
                    if (typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(checked);
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
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('auto'); },
                  title: 'About Auto-list',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              autoListEnabled && H('label', { className: 'toggle-card', style: { padding: '6px 10px' } },
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
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('inquiry'); },
                  title: 'Inquiry mode info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              H('label', { className: 'toggle-card', style: { padding: '6px 10px' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!aiDescriptionEnabled,
                  onChange: (e) => setAiDescriptionEnabled(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'AI descriptions'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'fill description for you')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('ai'); },
                  title: 'AI description tips',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              isMobile && H('label', { className: 'toggle-card', style: { padding: '6px 10px' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoPostNearbyEnabled,
                  onChange: (e) => setAutoPostNearbyEnabled(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Auto Nearby'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'auto-list extra option')
                ),
                H('button', {
                  type: 'button',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('nearby'); },
                  title: 'Nearby auto-post info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer'
                  }
                }, '?')
              ),
              H('button', {
                className: 'btn primary',
                type: 'button',
                onClick: onNewListing
              }, 'New listing'),
              H('button', {
                className: 'btn',
                type: 'button',
                onClick: onLogout
              }, 'Log out')
            )
          ),

          H('section', null,
            H('div', { className: 'row', style: { justifyContent: 'space-between', margin: '0 0 12px', flexWrap: 'wrap' } },
              H('section', { style: { marginTop: 12 } },
                H('label', null, 'PayPal email'),
                H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  H('input', {
                    value: paypalEmail,
                    onChange: e => setPaypalEmail(e.target.value),
                    placeholder: 'name@example.com',
                    style: { minWidth: 260 }
                  }),
                  H('button', { className: 'btn', onClick: savePaypal }, 'Save')
                ),
                H('div', { className: 'muted', style: { fontSize: 12, marginTop: 4 } },
                  'When you press "Reveal PayPal address" in a DM, the email you save here will be sent as a normal message.'
                )
              ),

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
