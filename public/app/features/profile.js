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

    function VerifiedBadgeIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
      H('polyline', { points: '3.5 8.5 6.5 11.5 12.5 4.5' }));
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

    const PhoneVerificationModal = React.memo(function PhoneVerificationModal({
      open,
      onClose,
      step,
      phone,
      code,
      onChangePhone,
      onChangeCode,
      onSubmitPhone,
      onVerifyCode,
      onResend,
      onEditPhone,
      loading,
      error,
      info,
      resending
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

      const submitting = !!loading;
      const trimmedCode = typeof code === 'string' ? code.trim() : '';
      const disableSubmit = submitting || (step === 'code' && trimmedCode.length !== 6);

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '420px',
              width: 'min(420px, 92vw)',
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
              title: 'Close verification'
            }, 'x'),
            H('div', { style: { display: 'grid', gap: 12 } },
              H('h2', {
                style: {
                  fontSize: 20,
                  fontWeight: 800,
                  margin: 0
                }
              }, 'Verify your account'),
              H('p', {
                className: 'muted',
                style: { fontSize: 13, margin: 0, lineHeight: '20px' }
              }, step === 'phone'
                ? 'Enter your mobile number so we can text you a verification code.'
                : `Enter the 6-digit code we texted to ${phone || 'your phone number'}.`),
              info && H('div', {
                role: 'status',
                'aria-live': 'polite',
                style: { fontSize: 13, color: '#047857', fontWeight: 600 }
              }, info),
              error && H('div', {
                role: 'alert',
                style: { fontSize: 13, color: '#b91c1c', fontWeight: 600 }
              }, error)
            ),
            H('form', {
              onSubmit: step === 'phone' ? onSubmitPhone : onVerifyCode,
              style: { display: 'grid', gap: 12 }
            },
              step === 'phone'
                ? H('div', { style: { display: 'grid', gap: 6 } },
                    H('label', { style: { fontWeight: 600 } }, 'Mobile phone'),
                    H('input', {
                      type: 'tel',
                      value: phone,
                      onChange: onChangePhone,
                      placeholder: '+15551234567',
                      disabled: submitting,
                      autoComplete: 'tel',
                      inputMode: 'tel',
                      required: true
                    })
                  )
                : H('div', { style: { display: 'grid', gap: 6 } },
                    H('label', { style: { fontWeight: 600 } }, 'Verification code'),
                    H('input', {
                      type: 'text',
                      value: code,
                      onChange: onChangeCode,
                      placeholder: '123456',
                      inputMode: 'numeric',
                      autoComplete: 'one-time-code',
                      disabled: submitting,
                      required: true
                    })
                  ),
              H('button', {
                type: 'submit',
                className: 'btn primary',
                disabled: disableSubmit
              }, submitting ? (step === 'phone' ? 'Sending…' : 'Verifying…') : (step === 'phone' ? 'Send code' : 'Verify'))
            ),
            step === 'code' && H('div', {
              style: { display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }
            },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: onEditPhone,
                disabled: submitting,
                style: { flex: '1', minWidth: '140px' }
              }, 'Use a different number'),
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: onResend,
                disabled: submitting || resending,
                style: { flex: '1', minWidth: '140px' }
              }, resending ? 'Sending…' : 'Resend code')
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
      const [paypalStatusMessage, setPaypalStatusMessage] = useState('');
      const [locationStatusMessage, setLocationStatusMessage] = useState('');

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
      const [verificationModalOpen, setVerificationModalOpen] = useState(false);
      const [verificationStep, setVerificationStep] = useState('phone');
      const [verificationPhone, setVerificationPhone] = useState(user?.phone_number || '');
      const [verificationCode, setVerificationCode] = useState('');
      const [verificationError, setVerificationError] = useState('');
      const [verificationInfo, setVerificationInfo] = useState('');
      const [verificationLoading, setVerificationLoading] = useState(false);
      const [verificationResending, setVerificationResending] = useState(false);

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

      if (useEffect) {
        useEffect(() => {
          const nextPaypal = (user?.paypal_email || '').trim();
          paypalEmailRef.current = nextPaypal;
          setPaypalEmailState(nextPaypal);
          setPaypalStatusMessage('');
        }, [user?.paypal_email]);
        useEffect(() => {
          const nextLocation = (user?.location_preset || '').trim();
          locationPresetRef.current = nextLocation;
          setLocationPresetState(nextLocation);
          setLocationStatusMessage('');
        }, [user?.location_preset]);
        useEffect(() => {
          setVerificationPhone((user?.phone_number || '').trim());
        }, [user?.phone_number]);
      }

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

      function formatVerificationError(message) {
        switch (message) {
          case 'invalid_request':
            return 'Please enter a valid phone number with 10-15 digits.';
          case 'invalid_code':
            return 'That code did not match. Try again.';
          case 'verification_expired':
            return 'That code expired. We sent you a new one.';
          case 'verification_not_requested':
            return 'We sent you a new code. Enter the latest one.';
          case 'verification_failed':
            return 'We could not complete verification. Try again.';
          default:
            return message || 'Something went wrong. Try again.';
        }
      }

      const handleOpenVerification = useCallback(() => {
        setVerificationModalOpen(true);
        setVerificationStep('phone');
        setVerificationPhone((user?.phone_number || '').trim());
        setVerificationCode('');
        setVerificationError('');
        setVerificationInfo('');
        setVerificationLoading(false);
        setVerificationResending(false);
      }, [user?.phone_number]);

      const handleCloseVerification = useCallback(() => {
        setVerificationModalOpen(false);
        setVerificationStep('phone');
        setVerificationCode('');
        setVerificationError('');
        setVerificationInfo('');
        setVerificationLoading(false);
        setVerificationResending(false);
      }, []);

      const handleVerificationPhoneChange = useCallback((event) => {
        setVerificationPhone(event?.target?.value || '');
        if (verificationError) {
          setVerificationError('');
        }
        setVerificationInfo('');
      }, [verificationError]);

      const handleVerificationCodeChange = useCallback((event) => {
        const nextValue = (event?.target?.value || '').replace(/[^0-9]/g, '').slice(0, 6);
        setVerificationCode(nextValue);
        if (verificationError) {
          setVerificationError('');
        }
      }, [verificationError]);

      const handleEditVerificationPhone = useCallback(() => {
        setVerificationStep('phone');
        setVerificationCode('');
        setVerificationError('');
        setVerificationInfo('');
      }, []);

      async function submitVerificationPhone(event) {
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        const trimmed = (verificationPhone || '').trim();
        if (!trimmed) {
          setVerificationError('Enter a phone number to continue.');
          return;
        }

        setVerificationLoading(true);
        setVerificationError('');
        setVerificationInfo('');

        try {
          const response = await api.requestPhoneVerification(trimmed);
          const nextPhone = typeof response?.phone_number === 'string' ? response.phone_number : trimmed;
          setVerificationPhone(nextPhone);
          setVerificationStep('code');
          setVerificationCode('');
          setVerificationInfo('We sent a 6-digit code to your phone. It may take a moment to arrive.');
          if (user) {
            navBridge.setUser?.({ ...user, phone_number: nextPhone, phone_verified: !!user.phone_verified });
          }
        } catch (err) {
          setVerificationError(formatVerificationError(err?.message));
        } finally {
          setVerificationLoading(false);
        }
      }

      async function submitVerificationCode(event) {
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        const trimmed = (verificationCode || '').trim();
        if (trimmed.length !== 6) {
          setVerificationError('Enter the 6-digit code from the text message.');
          return;
        }

        setVerificationLoading(true);
        setVerificationError('');
        setVerificationInfo('');

        try {
          const response = await api.confirmPhoneVerification(trimmed);
          if (user) {
            const nextUser = {
              ...user,
              phone_verified: true,
              phone_number: typeof response?.phone_number === 'string'
                ? response.phone_number
                : (verificationPhone || user.phone_number || '')
            };
            navBridge.setUser?.(nextUser);
          }
          try {
            const me = await api.me({ silent: true });
            if (me) {
              navBridge.setUser?.(me);
            }
          } catch (refreshErr) {
            console.error('Refresh user failed:', refreshErr);
          }
          setVerificationModalOpen(false);
          setVerificationStep('phone');
          setVerificationCode('');
          setVerificationError('');
          setVerificationInfo('');
        } catch (err) {
          const message = err?.message;
          if (message === 'verification_expired' || message === 'verification_not_requested') {
            setVerificationInfo('We sent you a new code. Enter the latest one to continue.');
            setVerificationError('The previous code is no longer valid.');
            return;
          }
          setVerificationError(formatVerificationError(message));
        } finally {
          setVerificationLoading(false);
        }
      }

      async function handleResendVerification() {
        const trimmed = (verificationPhone || '').trim();
        if (!trimmed) {
          setVerificationStep('phone');
          setVerificationError('Enter a phone number to resend the code.');
          return;
        }

        setVerificationResending(true);
        setVerificationError('');
        setVerificationInfo('');

        try {
          const response = await api.requestPhoneVerification(trimmed);
          const nextPhone = typeof response?.phone_number === 'string' ? response.phone_number : trimmed;
          setVerificationPhone(nextPhone);
          setVerificationInfo('We sent you a new code. It may take a moment to arrive.');
        } catch (err) {
          const message = err?.message;
          setVerificationError(formatVerificationError(message));
          if (message === 'invalid_request') {
            setVerificationStep('phone');
          }
        } finally {
          setVerificationResending(false);
        }
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
        H(PhoneVerificationModal, {
          open: verificationModalOpen,
          onClose: handleCloseVerification,
          step: verificationStep,
          phone: verificationPhone,
          code: verificationCode,
          onChangePhone: handleVerificationPhoneChange,
          onChangeCode: handleVerificationCodeChange,
          onSubmitPhone: submitVerificationPhone,
          onVerifyCode: submitVerificationCode,
          onResend: handleResendVerification,
          onEditPhone: handleEditVerificationPhone,
          loading: verificationLoading,
          error: verificationError,
          info: verificationInfo,
          resending: verificationResending
        }),
        H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
            H('div', null,
              H('div', { style: { fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 } },
                user.username ? `@${user.username}` : user.email,
                user.phone_verified && H('span', {
                  className: 'verified-badge',
                  title: 'This user verified their phone number'
                },
                  H(VerifiedBadgeIcon, null),
                  H('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Verified')
                )
              ),
              H('div', { className: 'muted', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
                'Your account',
                !user.phone_verified && H('button', {
                  type: 'button',
                  className: 'btn primary',
                  onClick: handleOpenVerification,
                  style: { padding: '4px 12px', fontSize: 13 }
                }, 'Verify account')
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
