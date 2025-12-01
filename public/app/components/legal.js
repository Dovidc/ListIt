(() => {
  function createLegalComponents({ React, ReactDOM, api } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Legal components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Legal components require ReactDOM.');
    }
    if (!api) {
      throw new Error('Legal components require an API client.');
    }

    const {
      useState,
      useEffect,
      useCallback,
      useRef
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function LegalAcceptanceModal({ open, onAccepted, user }) {
      const [loading, setLoading] = useState(true);
      const [accepting, setAccepting] = useState(false);
      const [error, setError] = useState('');
      const [document, setDocument] = useState(null);
      const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
      const scrollRef = useRef(null);

      useEffect(() => {
        if (!open) return;

        let alive = true;
        setLoading(true);
        setError('');
        setHasScrolledToBottom(false);

        (async () => {
          try {
            const doc = await api.getLegalDocuments();
            if (alive) {
              setDocument(doc);
              setLoading(false);
            }
          } catch (err) {
            if (alive) {
              setError('Failed to load legal documents. Please try again.');
              setLoading(false);
            }
          }
        })();

        return () => { alive = false; };
      }, [open]);

      const handleScroll = useCallback((e) => {
        const el = e.target;
        const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
        if (isAtBottom) {
          setHasScrolledToBottom(true);
        }
      }, []);

      const handleAccept = useCallback(async () => {
        if (!document) return;
        setAccepting(true);
        setError('');

        try {
          await api.acceptLegal(document.version);
          if (typeof onAccepted === 'function') {
            onAccepted();
          }
        } catch (err) {
          setError('Failed to save your acceptance. Please try again.');
        } finally {
          setAccepting(false);
        }
      }, [document, onAccepted]);

      if (!open) return null;

      const canAccept = hasScrolledToBottom && !accepting && !loading;

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          style: { zIndex: 10000 }
        },
          H('div', {
            className: 'modal-inner legal-modal',
            style: {
              maxWidth: 600,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              overflow: 'hidden',
              background: '#fff'
            }
          },
            // Header
            H('div', {
              style: {
                padding: '24px 24px 16px',
                borderBottom: '1px solid #e5e7eb'
              }
            },
              H('h2', {
                style: {
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#111'
                }
              }, 'Terms of Service & Privacy Policy'),
              H('p', {
                style: {
                  margin: '8px 0 0',
                  fontSize: 14,
                  color: '#6b7280'
                }
              }, 'Please review and accept to continue using Trovelr.')
            ),

            // Content area
            H('div', {
              ref: scrollRef,
              onScroll: handleScroll,
              style: {
                flex: 1,
                overflow: 'auto',
                padding: 24,
                minHeight: 300
              }
            },
              loading && H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 48,
                  color: '#6b7280'
                }
              }, 'Loading...'),

              !loading && document && H('div', {
                style: {
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: '#374151',
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }
              }, document.content || '')
            ),

            // Scroll hint
            !hasScrolledToBottom && !loading && H('div', {
              style: {
                padding: '8px 24px',
                background: '#fef3c7',
                color: '#92400e',
                fontSize: 13,
                textAlign: 'center'
              }
            }, 'Please scroll to the bottom to continue'),

            // Error message
            error && H('div', {
              style: {
                padding: '12px 24px',
                background: '#fef2f2',
                color: '#dc2626',
                fontSize: 14,
                textAlign: 'center'
              }
            }, error),

            // Footer
            H('div', {
              style: {
                padding: '16px 24px',
                borderTop: '1px solid #e5e7eb',
                background: '#f9fafb'
              }
            },
              H('button', {
                type: 'button',
                onClick: handleAccept,
                disabled: !canAccept,
                className: 'btn primary',
                style: {
                  width: '100%',
                  padding: '14px 24px',
                  fontSize: 16,
                  fontWeight: 600,
                  opacity: canAccept ? 1 : 0.5,
                  cursor: canAccept ? 'pointer' : 'not-allowed'
                }
              }, accepting ? 'Saving...' : 'I Agree')
            )
          )
        ),
        document.body
      );
    }

    return {
      LegalAcceptanceModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.legal = {
    createLegalComponents
  };
})();
