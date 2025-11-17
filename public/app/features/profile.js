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
      ListingsGrid,
      SupporterBadge,
      SelectBuyerModal
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
    if (typeof SupporterBadge !== 'function') {
      throw new Error('Profile feature requires SupporterBadge component.');
    }
    // ListingsGrid is optional - we'll fall back to custom rendering if not available

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const {
      useState,
      useCallback,
      useRef: reactUseRef,
      useMemo
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

    function formatElapsedSince(value) {
      if (!value) return null;
      const date = new Date(value);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      const diff = Date.now() - date.getTime();
      if (!Number.isFinite(diff) || diff <= 0) return 'just now';
      const units = [
        { label: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
        { label: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
        { label: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
        { label: 'day', ms: 1000 * 60 * 60 * 24 },
        { label: 'hour', ms: 1000 * 60 * 60 },
        { label: 'minute', ms: 1000 * 60 }
      ];
      for (const unit of units) {
        const valueCount = Math.floor(diff / unit.ms);
        if (valueCount >= 1) {
          return `${valueCount} ${unit.label}${valueCount === 1 ? '' : 's'} ago`;
        }
      }
      return 'just now';
    }

    function formatSubscriptionEndDate(value) {
      if (!value) return null;
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
      } catch (err) {
        console.warn('Failed to format subscription period end date:', err);
        return null;
      }
    }

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
        title: 'Offer Message',
        intro: 'When Offer is enabled it will:',
        bullets: [
          'Overlay the listing image with a banner inviting buyers to make an offer.'
        ],
        footer: 'Turn Offer off to show the price again.'
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
      locationStatusMessage,
      profileAbout,
      onChangeProfileAbout,
      onSaveProfileAbout,
      profileAboutStatusMessage
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
            H('section', { style: { display: 'grid', gap: 12 } },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap'
                }
              },
                H('span', { style: { fontWeight: 600 } }, 'About this seller'),
                H('span', {
                  className: 'muted',
                  style: { fontSize: 12 }
                }, 'Shown on your profile preview')
              ),
              H('textarea', {
                value: profileAbout,
                onChange: (evt) => onChangeProfileAbout?.(evt.target.value),
                placeholder: 'Share a short bio, shipping info, or what you sell.',
                rows: 4,
                maxLength: 600,
                style: { width: '100%', resize: 'vertical' }
              }),
              H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8
                }
              },
                H('span', {
                  className: 'muted',
                  style: { fontSize: 12 }
                }, `${(profileAbout || '').length}/600 characters`),
                H('button', {
                  className: 'btn primary',
                  type: 'button',
                  onClick: onSaveProfileAbout
                }, 'Save')
              ),
              profileAboutStatusMessage && H('div', {
                role: 'status',
                'aria-live': 'polite',
                style: {
                  fontSize: 13,
                  color: '#047857',
                  fontWeight: 600
                }
              }, profileAboutStatusMessage)
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

    const ProfileCustomizationModal = React.memo(function ProfileCustomizationModal({
      open,
      onClose,
      borderColor,
      onChangeBorderColor,
      borderStyle,
      onChangeBorderStyle,
      bgImageUrl,
      onUploadBgImage,
      onClearBgImage,
      bgImageUploading,
      bgImageUploadError,
      onSave,
      statusMessage,
      isPremium
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const uploadInputRef = useRef(null);

      const [previewScale, setPreviewScale] = useState(1.05);
      const [previewOffset, setPreviewOffset] = useState(50);

      if (useEffect) {
        useEffect(() => {
          setPreviewScale(1.05);
          setPreviewOffset(50);
        }, [bgImageUrl, open]);
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const handleBgImageFileChange = (evt) => {
        if (!isPremium || bgImageUploading) {
          evt.target.value = '';
          return;
        }
        const file = evt.target?.files && evt.target.files[0];
        if (file) {
          onUploadBgImage?.(file);
        }
        evt.target.value = '';
      };

      const premiumMsg = !isPremium ? H('div', {
        style: {
          padding: '12px',
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: 8,
          fontSize: 13,
          color: '#92400e',
          marginBottom: 12
        }
      }, '✨ Profile customization is a premium subscriber feature') : null;

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
              title: 'Close profile customization'
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
                '🎨 Profile Display',
                !isPremium && H('span', {
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    background: '#dbeafe',
                    color: '#0c4a6e',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 700
                  }
                }, '✨ Premium')
              ),
              H('p', {
                className: 'muted',
                style: { fontSize: 13, margin: 0 }
              }, 'Customize how your profile appears when others view it from listings.')
            ),
            premiumMsg,
            H('section', { style: { display: 'grid', gap: 12 } },
              H('label', { style: { display: 'grid', gap: 8 } },
                H('span', { style: { fontWeight: 600 } }, 'Avatar Border Color'),
                H('input', {
                  type: 'color',
                  value: borderColor,
                  onChange: (evt) => onChangeBorderColor?.(evt.target.value),
                  disabled: !isPremium,
                  style: { width: '100%', height: 40, cursor: isPremium ? 'pointer' : 'not-allowed' }
                })
              ),
              H('label', { style: { display: 'grid', gap: 8 } },
                H('span', { style: { fontWeight: 600 } }, 'Avatar Border Style'),
                H('select', {
                  value: borderStyle,
                  onChange: (evt) => onChangeBorderStyle?.(evt.target.value),
                  disabled: !isPremium,
                  style: {
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    cursor: isPremium ? 'pointer' : 'not-allowed'
                  }
                },
                  H('option', { value: 'solid' }, 'Solid'),
                  H('option', { value: 'dashed' }, 'Dashed')
                )
              ),
              H('label', { style: { display: 'grid', gap: 8 } },
                H('span', { style: { fontWeight: 600 } }, 'Banner Image'),
                H('div', {
                  style: {
                    position: 'relative',
                    border: '1px dashed #cbd5f5',
                    borderRadius: 10,
                    padding: 16,
                    background: '#f8fafc',
                    cursor: isPremium && !bgImageUploading ? 'pointer' : 'not-allowed',
                    transition: 'border-color 120ms ease, box-shadow 120ms ease',
                    boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.3)'
                  },
                  onClick: () => {
                    if (!isPremium || bgImageUploading) return;
                    uploadInputRef.current?.click();
                  },
                  onKeyDown: (evt) => {
                    if (!isPremium || bgImageUploading) return;
                    if (evt.key === 'Enter' || evt.key === ' ') {
                      evt.preventDefault();
                      uploadInputRef.current?.click();
                    }
                  },
                  onDragOver: (evt) => {
                    if (!isPremium || bgImageUploading) return;
                    evt.preventDefault();
                    evt.dataTransfer.dropEffect = 'copy';
                  },
                  onDrop: (evt) => {
                    if (!isPremium || bgImageUploading) return;
                    evt.preventDefault();
                    const droppedFile = evt.dataTransfer?.files && evt.dataTransfer.files[0];
                    if (droppedFile) {
                      onUploadBgImage?.(droppedFile);
                    }
                  },
                  role: 'button',
                  tabIndex: isPremium && !bgImageUploading ? 0 : -1,
                  'aria-label': 'Upload banner image'
                },
                  H('input', {
                    ref: uploadInputRef,
                    type: 'file',
                    accept: 'image/*',
                    disabled: !isPremium || bgImageUploading,
                    onChange: handleBgImageFileChange,
                    style: {
                      position: 'absolute',
                      inset: 0,
                      opacity: 0
                    }
                  }),
                  H('div', {
                    style: {
                      display: 'grid',
                      gap: 4,
                      color: '#1e3a8a'
                    }
                  },
                    H('strong', { style: { fontSize: 14 } }, 'Click to upload or drop an image'),
                    H('span', { style: { fontSize: 12, color: '#475569' } }, 'PNG, JPG, WEBP (8MB max)')
                  )
                ),
                bgImageUploading && H('div', {
                  role: 'status',
                  style: {
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#2563eb'
                  }
                }, 'Uploading image...'),
                bgImageUploadError && H('div', {
                  role: 'alert',
                  style: {
                    fontSize: 12,
                    color: '#b91c1c'
                  }
                }, bgImageUploadError),
                H('div', {
                  style: {
                    display: 'grid',
                    gap: 8,
                    marginTop: 4
                  }
                },
                  H('span', { style: { fontWeight: 600, fontSize: 13 } }, 'Preview & adjustments'),
                  H('div', {
                    style: {
                      position: 'relative',
                      width: '100%',
                      height: 190,
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#0f172a',
                      boxShadow: '0 12px 25px rgba(15, 23, 42, 0.35)',
                      display: 'grid',
                      placeItems: 'center'
                    }
                  },
                    bgImageUrl
                      ? H('img', {
                          src: bgImageUrl,
                          alt: 'Banner preview',
                          style: {
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: `50% ${previewOffset}%`,
                            transform: `scale(${previewScale})`,
                            transition: 'transform 150ms ease, object-position 150ms ease'
                          }
                        })
                      : H('div', {
                          style: {
                            color: '#94a3b8',
                            fontSize: 18,
                            textAlign: 'center',
                            padding: '0 16px'
                          }
                        }, 'Upload an image to see a live preview')
                  ),
                  H('label', {
                    style: { display: 'grid', gap: 4 }
                  },
                    H('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Zoom'),
                    H('input', {
                      type: 'range',
                      min: 1,
                      max: 1.35,
                      step: 0.01,
                      value: previewScale,
                      onChange: (evt) => setPreviewScale(Number(evt.target.value) || 1),
                      disabled: !bgImageUrl
                    })
                  ),
                  H('label', {
                    style: { display: 'grid', gap: 4 }
                  },
                    H('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Vertical focus'),
                    H('input', {
                      type: 'range',
                      min: 0,
                      max: 100,
                      step: 1,
                      value: previewOffset,
                      onChange: (evt) => setPreviewOffset(Number(evt.target.value) || 50),
                      disabled: !bgImageUrl
                    })
                  ),
                  H('p', {
                    className: 'muted',
                    style: { fontSize: 12, margin: 0 }
                  }, 'Tip: the preview controls let you experiment before committing the banner.'),
                  bgImageUrl && H('div', {
                    style: {
                      display: 'flex',
                      justifyContent: 'flex-end'
                    }
                  },
                    H('button', {
                      type: 'button',
                      onClick: () => onClearBgImage?.(),
                      disabled: !isPremium || bgImageUploading,
                      style: {
                        border: 'none',
                        background: '#fee2e2',
                        color: '#b91c1c',
                        borderRadius: 999,
                        padding: '6px 14px',
                        cursor: isPremium && !bgImageUploading ? 'pointer' : 'not-allowed'
                      }
                    }, 'Remove image')
                  )
                )
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
                  onClick: onSave,
                  disabled: !isPremium
                }, 'Save Changes')
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
            )
          )
        ),
        document.body
      );
    });

    const ProfileSettingsModal = React.memo(function ProfileSettingsModal({
      open,
      onClose,
      onRequestHelp,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      aiDescriptionEnabled,
      setAiDescriptionEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      onRequestDeleteAccount,
      onRequestCancelSubscription,
      isMobile,
      user,
      subscriptionStatus: modalSubscriptionStatus
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const subscriptionStatus = modalSubscriptionStatus ?? user?.subscription_status ?? null;
      const cancellationDateText = formatSubscriptionEndDate(user?.subscription_current_period_end);
      const subscriptionMessage = subscriptionStatus === 'canceling'
        ? (cancellationDateText
          ? `Your cancellation is scheduled. Your subscription will end on ${cancellationDateText}. You will keep your supporter perks until then and can renew your subscription once it ends.`
          : 'Your cancellation is scheduled. You will keep your supporter perks until the end of your current billing period and can renew your subscription once it ends.')
        : 'You have an active monthly subscription';

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
                  checked: !!autoInquiryEnabled,
                  onChange: (e) => {
                    if (typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(e.target.checked);
                    }
                  }
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Offer Message'),
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
              // Show cancel subscription button for premium monthly subscribers
              user?.supporter_tier === 'premium' && user?.stripe_subscription_id && H('div', {
                style: {
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: '1px solid #e5e7eb'
                }
              },
                H('div', { style: { fontWeight: 700, marginBottom: 8 } }, 'Subscription'),
                H('div', { className: 'muted', style: { fontSize: 14, marginBottom: 12 } }, subscriptionMessage),
                H('button', {
                  className: 'btn',
                  onClick: subscriptionStatus === 'canceling' ? undefined : onRequestCancelSubscription,
                  disabled: subscriptionStatus === 'canceling',
                  style: {
                    width: '100%',
                    background: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    cursor: subscriptionStatus === 'canceling' ? 'not-allowed' : 'pointer',
                    opacity: subscriptionStatus === 'canceling' ? 0.7 : 1
                  }
                }, subscriptionStatus === 'canceling' ? 'Cancellation Scheduled' : 'Cancel Subscription')
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
      aiDescriptionEnabled,
      setAiDescriptionEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      onViewSeller,
      onToggleSold,
      onSupporterClick,
      onJoinSupporterProgram
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
      const [karmaModalOpen, setKarmaModalOpen] = useState(false);
      const [karmaListingId, setKarmaListingId] = useState(null);
      const [subscriptionStatus, setSubscriptionStatus] = useState(user?.subscription_status || null);
      const [profileAvatarBorderColor, setProfileAvatarBorderColor] = useState(user?.profile_avatar_border_color || '#ffffff');
      const [profileAvatarBorderStyle, setProfileAvatarBorderStyle] = useState(user?.profile_avatar_border_style || 'solid');
      const [profileBgImageUrl, setProfileBgImageUrl] = useState(user?.profile_bg_image_url || user?.profile_bg_video_url || '');
      const [profileBgImageUploading, setProfileBgImageUploading] = useState(false);
      const [profileBgImageUploadError, setProfileBgImageUploadError] = useState('');
      const [profileCustomizationModalOpen, setProfileCustomizationModalOpen] = useState(false);
      const [profileCustomizationStatusMessage, setProfileCustomizationStatusMessage] = useState('');
      const isPremiumUser = useMemo(() => user?.supporter_tier === 'premium' || user?.subscription_status === 'active', [user]);

      useEffect(() => {
        if (!user) return;
        const url = user.profile_picture_url || '';

        // Only update state if user object has the profile_picture_url property
        // This prevents overwriting with empty string when user object is being updated
        if ('profile_picture_url' in user) {
          setProfilePictureUrl(url);
        }
      }, [user]);

      useEffect(() => {
        if (user && 'subscription_status' in user) {
          setSubscriptionStatus(user.subscription_status || null);
        }
      }, [user]);

      useEffect(() => {
        if (!user) return;
        if ('profile_bg_image_url' in user || 'profile_bg_video_url' in user) {
          setProfileBgImageUrl(user.profile_bg_image_url || user.profile_bg_video_url || '');
        }
      }, [user]);

      useEffect(() => {
        if (!user) return;
        if ('profile_about' in user) {
          setProfileAbout(user.profile_about || '');
        }
      }, [user, setProfileAbout]);

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
      const [profileAboutState, setProfileAboutState] = useState(user?.profile_about || '');
      const profileAboutRef = useRef(profileAboutState);
      const setProfileAbout = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(profileAboutRef.current) : value;
        profileAboutRef.current = resolved;
        setProfileAboutState(resolved);
      }, [profileAboutRef, setProfileAboutState]);
      const profileAbout = profileAboutState;
      const [profileAboutStatusMessage, setProfileAboutStatusMessage] = useState('');
      const profileSupporter = useMemo(() => {
        if (!user || !user.supporter_badge) {
          return null;
        }
        const usernameLabel = user.username
          ? user.username
          : (user.email || 'This user');
        return {
          username: usernameLabel,
          since: user.supporter_since || null
        };
      }, [user]);
      const userCreatedAt = user?.created_at || null;
      const userJoinedText = useMemo(() => {
        if (!userCreatedAt) return null;
        return formatElapsedSince(userCreatedAt);
      }, [userCreatedAt]);
      const handleSelfSupporterClick = useCallback(() => {
        if (!profileSupporter) return;
        onSupporterClick?.({
          username: profileSupporter.username,
          since: profileSupporter.since || null,
          isSelf: true
        });
      }, [onSupporterClick, profileSupporter]);
      const handleJoinSupporterClick = useCallback(() => {
        if (typeof onJoinSupporterProgram === 'function') {
          onJoinSupporterProgram();
        }
      }, [onJoinSupporterProgram]);
      const showSupporterCta = !profileSupporter && typeof onJoinSupporterProgram === 'function';
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

      const handleChangeProfileAbout = useCallback((value) => {
        setProfileAbout(value);
        if (profileAboutStatusMessage) {
          setProfileAboutStatusMessage('');
        }
      }, [profileAboutStatusMessage, setProfileAbout]);
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

      async function saveProfileAbout() {
        const currentValue = profileAboutRef.current || '';
        let response;
        try {
          if (typeof api.updateProfileAbout !== 'function') {
            throw new Error('updateProfileAbout unavailable');
          }
          response = await api.updateProfileAbout(currentValue);
        } catch (err) {
          alert(err?.message || 'Failed to save about text.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextAbout = typeof response?.profile_about === 'string' ? response.profile_about : (currentValue || '');
        setProfileAbout(nextAbout);
        if (user) {
          navBridge.setUser?.({ ...user, profile_about: nextAbout });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setProfileAboutStatusMessage('Saved');
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

      const saveProfileCustomization = useCallback(async () => {
        if (!api || typeof api.updateProfileCustomization !== 'function') {
          alert('Profile customization API not available');
          return;
        }
        try {
          setProfileCustomizationStatusMessage('Saving...');
          const response = await api.updateProfileCustomization({
            profile_avatar_border_color: profileAvatarBorderColor,
            profile_avatar_border_style: profileAvatarBorderStyle,
            profile_bg_image_url: profileBgImageUrl
          });
          if (response?.error) {
            alert(response.error);
            setProfileCustomizationStatusMessage('');
            return;
          }
          if (user) {
            navBridge.setUser?.({
              ...user,
              profile_avatar_border_color: profileAvatarBorderColor,
              profile_avatar_border_style: profileAvatarBorderStyle,
              profile_bg_video_url: null,
              profile_bg_image_url: profileBgImageUrl
            });
          }
          setProfileCustomizationStatusMessage('Saved!');
          setTimeout(() => {
            setProfileCustomizationStatusMessage('');
          }, 2000);
        } catch (err) {
          alert(err?.message || 'Failed to save profile customization');
          setProfileCustomizationStatusMessage('');
        }
      }, [profileAvatarBorderColor, profileAvatarBorderStyle, profileBgImageUrl, user]);

      const handleUploadProfileBgImage = useCallback(async (file) => {
        if (!file || !isPremiumUser) {
          return;
        }
        if (!api?.signUpload || !api?.finalizeUpload) {
          setProfileBgImageUploadError('Uploads are unavailable right now.');
          return;
        }
        if (!file.type || !file.type.startsWith('image/')) {
          setProfileBgImageUploadError('Please upload an image file.');
          return;
        }
        const maxBytes = 8 * 1024 * 1024;
        if (file.size > maxBytes) {
          setProfileBgImageUploadError('Image must be under 8MB.');
          return;
        }
        setProfileBgImageUploading(true);
        setProfileBgImageUploadError('');
        try {
          const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
          if (!sig || sig.error || !sig.uploadUrl || !sig.publicUrl || !sig.Key) {
            throw new Error(sig?.error || 'Upload failed');
          }
          const uploadRes = await fetch(sig.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
          });
          if (!uploadRes.ok) {
            throw new Error('Upload failed');
          }
          const finalizeRes = await api.finalizeUpload({ key: sig.Key, url: sig.publicUrl, bytes: file.size }, { silent: true });
          if (finalizeRes?.error) {
            throw new Error(finalizeRes.error);
          }
          const nextUrl = finalizeRes?.url || sig.publicUrl;
          setProfileBgImageUrl(nextUrl);
          setProfileCustomizationStatusMessage('Image uploaded. Click Save to keep it.');
        } catch (err) {
          console.error('Profile banner image upload failed:', err);
          setProfileBgImageUploadError(err?.message || 'Failed to upload image');
        } finally {
          setProfileBgImageUploading(false);
        }
      }, [api, isPremiumUser]);

      const handleClearProfileBgImage = useCallback(() => {
        if (!isPremiumUser) {
          return;
        }
        setProfileBgImageUrl('');
        setProfileBgImageUploadError('');
        setProfileCustomizationStatusMessage('Background image removed. Click Save to apply.');
      }, [isPremiumUser]);

      const handleRequestCancelSubscription = useCallback(async () => {
        if (!confirm('Are you sure you want to cancel your monthly subscription? You will keep your supporter badge until the end of your current billing period.')) {
          return;
        }

        try {
          await api.cancelSubscription();
          setSubscriptionStatus('canceling');
          if (user) {
            navBridge.setUser?.({ ...user, subscription_status: 'canceling' });
          }
          setSettingsOpen(false);
          // Refresh user data to update UI
          window.location.reload();
        } catch (err) {
          console.error('Cancel subscription failed:', err);
          alert(err.message || 'Failed to cancel subscription');
        }
      }, [user]);

      const handleToggleSoldWithKarma = useCallback(async (listing, makeSold) => {
        console.log('=== KARMA HANDLER START ===');
        console.log('Listing:', listing);
        console.log('Make sold?', makeSold);
        console.log('User object:', user);
        console.log('User tier:', user?.supporter_tier);
        console.log('handleToggleSoldWithKarma called:', {
          listingId: listing?.id,
          makeSold,
          userTier: user?.supporter_tier,
          willShowModal: makeSold && user?.supporter_tier === 'premium'
        });

        if (makeSold && user?.supporter_tier === 'premium') {
          // Show karma modal for premium users when marking as sold
          console.log('Opening karma modal for listing:', listing.id);
          console.log('Setting karmaListingId to:', listing.id);
          console.log('Setting karmaModalOpen to true');
          setKarmaListingId(listing.id);
          setKarmaModalOpen(true);
          console.log('Modal state updated');
          // Don't mark as sold yet - wait for modal
        } else {
          // Non-premium users or unmarking sold - proceed normally
          console.log('Proceeding with normal toggle sold');
          console.log('Reason: makeSold=', makeSold, 'tier=', user?.supporter_tier);
          await onToggleSold?.(listing, makeSold);
        }
        console.log('=== KARMA HANDLER END ===');
      }, [user, onToggleSold]);

      const handleKarmaBuyerSelected = useCallback(async (result) => {
        setKarmaModalOpen(false);
        const listing = items.find(it => it.id === karmaListingId);
        if (listing) {
          // Now mark as sold after karma is awarded
          await onToggleSold?.(listing, true);
        }
        setKarmaListingId(null);
      }, [karmaListingId, items, onToggleSold]);

      const handleKarmaModalClose = useCallback(async () => {
        setKarmaModalOpen(false);
        const listing = items.find(it => it.id === karmaListingId);
        if (listing) {
          // User skipped karma - mark as sold anyway
          await onToggleSold?.(listing, true);
        }
        setKarmaListingId(null);
      }, [karmaListingId, items, onToggleSold]);

      if (!user) {
        return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
          H('div', { className: 'muted' }, 'Please log in to view your profile.')
        );
      }

      const activeItems = asArray(items).filter(it => !it?.sold);
      const soldItems = asArray(items).filter(it => !!it?.sold);
      const shownItems = profileTab === 'sold' ? soldItems : activeItems;
      const trimmedBgImageUrl = (profileBgImageUrl || '').trim();
      const hasBgImage = !!trimmedBgImageUrl;
      const profileHeaderContent = H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
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
                      }
                    })
                  : (user.username ? user.username.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase())
              ),
              H('div', { style: { display: 'grid', gap: 6, alignItems: 'flex-start' } },
                H('div', { style: { fontWeight: 800, fontSize: 18 } },
                  user.username ? user.username : user.email
                ),
                userJoinedText && H('div', { className: 'muted' }, `Trovelr since ${userJoinedText}`),
                profileSupporter && H('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8
                  }
                },
                  H(SupporterBadge, {
                    size: 'sm',
                    since: profileSupporter.since,
                    onClick: handleSelfSupporterClick
                  })
                ),
                profileSupporter && typeof user.karma === 'number' && user.karma > 0 && H('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#374151',
                    border: '1px solid #d1d5db'
                  }
                },
                  H('span', { style: { fontSize: 14 } }, '⭐'),
                  H('span', null, `${user.karma} Karma`)
                ),
                showSupporterCta && H('button', {
                  className: 'btn primary',
                  type: 'button',
                  onClick: handleJoinSupporterClick,
                  style: { alignSelf: 'flex-start' }
                }, 'Get the Trovelr supporter badge'),
                showSupporterCta && H('span', {
                  className: 'muted',
                  style: {
                    fontSize: 12,
                    lineHeight: 1.45,
                    maxWidth: 280
                  }
                }, 'Donate once to unlock a dazzling golden badge on every listing you share.')
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
                onClick: () => setProfileCustomizationModalOpen(true),
                title: 'Customize profile display',
                style: iconButtonStyle
              },
                H('span', null, '🎨'),
                H('span', { style: visuallyHidden }, 'Customize profile')
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
          );
      const profileHeader = hasBgImage
        ? H('div', {
            style: {
              position: 'relative',
              minHeight: 180,
              overflow: 'hidden'
            }
          },
            trimmedBgImageUrl
              ? H('img', {
                  key: trimmedBgImageUrl,
                  src: trimmedBgImageUrl,
                  alt: 'Profile banner',
                  loading: 'lazy',
                  decoding: 'async',
                  style: {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }
                })
              : null,
            H('div', {
              style: {
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.15) 0%, rgba(15, 23, 42, 0.92) 100%)'
              }
            }),
            H('div', {
              style: {
                position: 'relative',
                padding: '36px 16px 20px',
                color: '#f8fafc'
              }
            }, profileHeaderContent)
          )
        : profileHeaderContent;
      const profileSections = [
        H('section', {
          className: 'card',
          style: {
            padding: hasBgImage ? 0 : 16,
            margin: '12px 0 16px',
            overflow: hasBgImage ? 'hidden' : undefined,
            background: hasBgImage ? '#020617' : undefined,
            color: hasBgImage ? '#f8fafc' : undefined
          }
        }, profileHeader),

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
                    columns: isMobile ? 3 : 4,
                    onSupporterClick
                  })
                : H('div', { style: { padding: 16 } }, 'ListingsGrid component not available')
              )
            : H('p', {
                className: 'muted',
                style: { textAlign: 'center', margin: '28px 0' }
              }, profileTab === 'sold' ? 'No sold listings yet.' : 'No listings yet. Create your first one!')
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
          locationStatusMessage: locationStatusMessage,
          profileAbout,
          onChangeProfileAbout: handleChangeProfileAbout,
          onSaveProfileAbout: saveProfileAbout,
          profileAboutStatusMessage
        }),

        H(ProfileCustomizationModal, {
          open: profileCustomizationModalOpen,
          onClose: () => setProfileCustomizationModalOpen(false),
          borderColor: profileAvatarBorderColor,
          onChangeBorderColor: setProfileAvatarBorderColor,
          borderStyle: profileAvatarBorderStyle,
          onChangeBorderStyle: setProfileAvatarBorderStyle,
          bgImageUrl: profileBgImageUrl,
          onUploadBgImage: handleUploadProfileBgImage,
          onClearBgImage: handleClearProfileBgImage,
          bgImageUploading: profileBgImageUploading,
          bgImageUploadError: profileBgImageUploadError,
          onSave: saveProfileCustomization,
          statusMessage: profileCustomizationStatusMessage,
          isPremium: isPremiumUser
        }),

        H(ProfileSettingsModal, {
          open: settingsOpen,
          onClose: handleCloseSettings,
          onRequestHelp: setHelpModal,
          autoInquiryEnabled,
          setAutoInquiryEnabled,
          aiDescriptionEnabled,
          setAiDescriptionEnabled,
          autoPostNearbyEnabled,
          setAutoPostNearbyEnabled,
          onRequestDeleteAccount: handleRequestDeleteAccount,
          onRequestCancelSubscription: handleRequestCancelSubscription,
          isMobile,
          user,
          subscriptionStatus
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
            onToggleSold: handleToggleSoldWithKarma,
            showDistance: false,
            onSupporterClick
          }
        }),

        H(SelectBuyerModal, {
          open: karmaModalOpen,
          onClose: handleKarmaModalClose,
          listingId: karmaListingId,
          onBuyerSelected: handleKarmaBuyerSelected
        })
      ];

      return H(React.Fragment, null, ...profileSections);
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
