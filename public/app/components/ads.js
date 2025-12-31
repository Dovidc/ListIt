(() => {
  function createAdsComponents({ React, components = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Ads components require React.');
    }

    const { ImageWithSkeleton } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Ads components require ImageWithSkeleton component.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function AdTile({ ad, cols = 4, className, preview = false }) {
      if (!ad) return null;
      const hasImage = !!ad.image_url;
      const isFullbleed = ad.display_mode === 'fullbleed' && hasImage;
      const href = ad.target_url || '#';
      const ctaLabel = (ad.cta_label || 'Visit site').slice(0, 40);
      // Fill the container (parent controls size via absolute positioning)
      // Calculate image size - default to 45% if not set
      const imageSize = Number.isFinite(Number(ad.image_size)) ? Number(ad.image_size) : 45;
      const style = { width: '100%', height: '100%', '--ad-image-size': `${imageSize}%` };
      if (ad.background && !isFullbleed) style.background = ad.background;
      if (preview) style.cursor = 'default';
      const cardClass = `card ad-card${hasImage ? '' : ' no-art'}${isFullbleed ? ' ad-card--fullbleed' : ''}${className ? ` ${className}` : ''}`;
      const anchorProps = {
        className: cardClass,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        style
      };
      if (preview) {
        anchorProps.onClick = (e) => e.preventDefault();
        anchorProps.target = '_self';
        anchorProps.rel = 'noopener';
        anchorProps.tabIndex = -1;
      }

      // Fullbleed mode: image fills entire card, small "Ad" pill in corner
      if (isFullbleed) {
        return H('a', anchorProps,
          H('div', { className: 'ad-card__fullbleed-image' },
            H(ImageWithSkeleton, {
              src: ad.image_url,
              alt: ad.title ? `${ad.title}` : 'Ad',
              loading: 'lazy',
              decoding: 'async'
            })
          ),
          H('span', { className: 'ad-card__pill' }, 'Ad')
        );
      }

      // Standard mode: text + optional image
      const artStyle = imageSize > 0 ? {} : { display: 'none' };
      return H('a', anchorProps,
        H('div', { className: 'ad-card__content' },
          H('span', { className: 'ad-card__tag' }, 'Sponsored'),
          H('div', { className: 'ad-card__title' }, ad.title || 'Advertisement'),
          ad.subtitle && H('div', { className: 'ad-card__subtitle' }, ad.subtitle),
          H('div', { className: 'ad-card__ctaRow' },
            H('span', { className: 'ad-card__cta' }, ctaLabel),
            H('span', { className: 'ad-card__arrow' }, '>')
          )
        ),
        hasImage && H('div', { className: 'ad-card__art', style: artStyle },
          H(ImageWithSkeleton, {
            src: ad.image_url,
            alt: ad.title ? `${ad.title} artwork` : 'Advertisement art',
            loading: 'lazy',
            decoding: 'async'
          })
        )
      );
    }

    return {
      AdTile
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.ads = {
    createAdsComponents
  };
})();
