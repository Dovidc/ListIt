(() => {
  function createAdminComponents({ React, ReactDOM } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Admin components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Admin components require ReactDOM.');
    }

    const {
      useMemo,
      useEffect
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function FlaggedDetailsModal({ open, detail, item, onClose }) {
      const isImage = (detail?.type || '').toLowerCase() === 'image';
      const target = typeof detail?.target === 'string' ? detail.target : '';
      const categories = useMemo(() => {
        if (!detail || !Array.isArray(detail.categories)) return [];
        return detail.categories.filter(Boolean);
      }, [detail]);
      const scores = detail && detail.category_scores && typeof detail.category_scores === 'object'
        ? detail.category_scores
        : null;

      useEffect(() => {
        if (!open) return;
        const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);

      if (!open || !detail) return null;

      const typeLabel = detail?.type ? detail.type.charAt(0).toUpperCase() + detail.type.slice(1) : 'Content';
      let flaggedAt = '';
      if (item?.flagged_at) {
        const dt = new Date(item.flagged_at);
        flaggedAt = Number.isFinite(dt.getTime()) ? dt.toLocaleString() : item.flagged_at;
      }

      const handleOuterClick = (event) => {
        if (event.target.classList?.contains('modal')) onClose?.();
      };

      const scoreEntries = scores ? Object.entries(scores).filter(([key, value]) => key && value != null) : [];

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOuterClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: isImage ? '720px' : '520px',
              width: '90%',
              padding: '24px',
              background: '#fff',
              color: '#111',
              display: 'grid',
              gap: 16
            }
          },
            H('button', { className: 'close', onClick: onClose }, '×'),
            H('div', { style: { display: 'grid', gap: 4 } },
              H('h3', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Flagged content'),
              item?.username && H('div', { className: 'muted', style: { fontSize: 13 } }, `User: ${item.username}`),
              item?.listing_title && H('div', { className: 'muted', style: { fontSize: 13 } }, `Listing: ${item.listing_title}`),
              flaggedAt && H('div', { className: 'muted', style: { fontSize: 12 } }, `Flagged: ${flaggedAt}`),
              H('div', { className: 'muted', style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 } }, typeLabel)
            ),
            categories.length ? H('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              categories.map((category) => H('span', {
                key: category,
                style: {
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: 12,
                  fontWeight: 600
                }
              }, category))
            ) : null,
            isImage
              ? (target
                ? H('div', {
                    style: {
                      display: 'grid',
                      gap: 8
                    }
                  },
                    H('img', {
                      src: target,
                      alt: 'Flagged content preview',
                      style: {
                        maxWidth: '100%',
                        borderRadius: 12,
                        border: '1px solid #e5e7eb',
                        background: '#f8fafc'
                      }
                    }),
                    H('div', { className: 'muted', style: { fontSize: 12 } }, 'Right-click or long-press to save this image if needed.')
                  )
                : H('div', { className: 'muted', style: { fontSize: 13 } }, 'No image preview available.'))
              : H('div', {
                  style: {
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 14,
                    lineHeight: 1.5,
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #e5e7eb',
                    background: '#f8fafc'
                  }
                }, target ? target : 'No text was captured for this entry.'),
            scoreEntries.length ? H('div', { style: { display: 'grid', gap: 6 } },
              H('div', { style: { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#111' } }, 'Confidence scores'),
              H('div', { style: { display: 'grid', gap: 4 } },
                scoreEntries.map(([category, value]) => {
                  const numeric = Number(value);
                  if (!Number.isFinite(numeric)) return null;
                  return H('div', { key: category, className: 'muted', style: { fontSize: 12 } }, `${category}: ${(numeric * 100).toFixed(1)}%`);
                }).filter(Boolean)
              )
            ) : null
          )
        ),
        document.body
      );
    }

    return {
      FlaggedDetailsModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.admin = window.ListItApp.features.admin || {};
  window.ListItApp.features.admin.createAdminComponents = createAdminComponents;
})();
