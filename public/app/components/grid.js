(() => {
  function createGridComponents({ React, components = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Grid components require React.');
    }

    const { ImageWithSkeleton } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Grid components require ImageWithSkeleton component.');
    }

    const { useEffect, useRef } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const GridTile = React.memo(function GridTile({ item, onEnsureCover, onSelect }) {
      const ref = useRef(null);

      useEffect(() => {
        const el = ref.current;
        if (!el || !item?.id) return;

        const observer = new IntersectionObserver((entries) => {
          if (!Array.isArray(entries)) return;
          const intersecting = entries.some((entry) => entry.isIntersecting);
          if (intersecting) {
            if (!item.__cover && typeof onEnsureCover === 'function') {
              onEnsureCover(item.id);
            }
            observer.disconnect();
          }
        }, { rootMargin: '800px 0px' });

        observer.observe(el);
        return () => observer.disconnect();
      }, [item?.id, item?.__cover, onEnsureCover]);

      const src = item?.__cover;

      return H('div', { ref, className: 'card', style: { padding: 0, overflow: 'hidden', borderRadius: 8 } },
        H('div', { style: { position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f3f4f6' } },
          src && H(ImageWithSkeleton, {
            src,
            alt: item?.title || 'Item',
            loading: 'lazy',
            decoding: 'async',
            fetchPriority: 'low',
            style: {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              cursor: 'pointer'
            },
            disableSkeleton: true,
            onClick: (evt) => typeof onSelect === 'function' ? onSelect(evt, item, src) : undefined
          })
        )
      );
    });

    return {
      GridTile
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.grid = {
    createGridComponents
  };
})();
