(() => {
  function createListingComponents({
    React,
    ReactDOM,
    api,
    uploads = {},
    helpers = {},
    components = {},
    formatting = {}
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Listing components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Listing components require ReactDOM.');
    }
    if (!api) {
      throw new Error('Listing components require an API client.');
    }

    const {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT,
      collectListingImages,
      dedupeImageUrls,
      fetchListingImagesCached,
      listingImageCache,
      listingImageInFlight
    } = uploads;

    if (typeof clearDraftCacheForFile !== 'function') {
      throw new Error('Listing components require clearDraftCacheForFile.');
    }
    if (typeof uploadFileDraft !== 'function') {
      throw new Error('Listing components require uploadFileDraft.');
    }
    if (typeof uploadFilesForListing !== 'function') {
      throw new Error('Listing components require uploadFilesForListing.');
    }
    if (typeof useFilePreviews !== 'function') {
      throw new Error('Listing components require useFilePreviews.');
    }
    if (typeof collectListingImages !== 'function') {
      throw new Error('Listing components require collectListingImages helper.');
    }
    if (typeof dedupeImageUrls !== 'function') {
      throw new Error('Listing components require dedupeImageUrls helper.');
    }
    if (typeof fetchListingImagesCached !== 'function') {
      throw new Error('Listing components require fetchListingImagesCached helper.');
    }
    if (!listingImageCache) {
      throw new Error('Listing components require listingImageCache.');
    }
    if (!listingImageInFlight) {
      throw new Error('Listing components require listingImageInFlight.');
    }

    const {
      isMobileDevice,
      isCapacitorNative,
      pickGalleryImages,
      createConcurrencyLimiter,
      fetchCoordsAndReverse,
      getUserCoordsOnce,
      useBodyScrollLock,
      haversineMeters,
      asArray,
      selectPrimaryListingImage
    } = helpers;

    if (typeof isMobileDevice !== 'function') {
      throw new Error('Listing components require isMobileDevice helper.');
    }
    if (typeof createConcurrencyLimiter !== 'function') {
      throw new Error('Listing components require createConcurrencyLimiter helper.');
    }
    if (typeof getUserCoordsOnce !== 'function') {
      throw new Error('Listing components require getUserCoordsOnce helper.');
    }
    if (typeof useBodyScrollLock !== 'function') {
      throw new Error('Listing components require useBodyScrollLock helper.');
    }
    if (typeof haversineMeters !== 'function') {
      throw new Error('Listing components require haversineMeters helper.');
    }
    if (typeof asArray !== 'function') {
      throw new Error('Listing components require asArray helper.');
    }
    if (typeof selectPrimaryListingImage !== 'function') {
      throw new Error('Listing components require selectPrimaryListingImage helper.');
    }

    const { ImageWithSkeleton, ResponsiveImage, ListingsGrid, SupporterBadge } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Listing components require ImageWithSkeleton component.');
    }
    if (typeof ResponsiveImage !== 'function') {
      throw new Error('Listing components require ResponsiveImage component.');
    }
    if (typeof SupporterBadge !== 'function') {
      throw new Error('Listing components require SupporterBadge component.');
    }
    // ListingsGrid is optional - will fall back to custom rendering if not available

    const price = formatting?.price;
    if (typeof price !== 'function') {
      throw new Error('Listing components require price formatter.');
    }
    const fmtDistance = formatting?.fmtDistance;
    if (typeof fmtDistance !== 'function') {
      throw new Error('Listing components require distance formatter.');
    }

    const {
      useState,
      useEffect,
      useRef,
      useMemo,
      useCallback
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function formatLocationDisplay(result, fallback = '') {
      const safeFallback = typeof fallback === 'string' ? fallback : '';
      if (!result || typeof result !== 'object') return safeFallback;
      const city = typeof result.city === 'string' ? result.city.trim() : '';
      const state = typeof result.state === 'string' ? result.state.trim() : '';
      const country = typeof result.country === 'string' ? result.country.trim() : '';
      const primary = city;
      const secondary = state || country;
      const joined = [primary, secondary].filter(Boolean).join(', ');
      if (joined) return joined;
      const display = typeof result.display === 'string' ? result.display.trim() : '';
      return display || safeFallback;
    }

    function formatRelativeTime(dateValue) {
      if (!dateValue) return null;
      const date = new Date(dateValue);
      if (!Number.isFinite(date.getTime())) return null;

      const now = Date.now();
      const diffMs = now - date.getTime();
      if (diffMs < 0) return null;

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);

      if (months > 0) {
        return months === 1 ? '1 month ago' : `${months} months ago`;
      }
      if (weeks > 0) {
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
      }
      if (days > 0) {
        return days === 1 ? '1 day ago' : `${days} days ago`;
      }
      if (hours > 0) {
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
      }
      if (minutes > 0) {
        return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
      }
      return 'Just now';
    }

    // --- Tiered Supporter Badge (Copper -> Unobtainium) ---
    function TieredSupporterBadge({ since, size = 20, onClick }) {
      const [showTooltip, setShowTooltip] = useState(false);
      const badgeRef = useRef(null);

      // Calculate duration from supporter_since
      const sinceDate = since ? new Date(since) : null;
      const now = Date.now();
      const timeDiff = sinceDate ? now - sinceDate.getTime() : 0;
      const monthsSince = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 30));
      const yearsSince = Math.floor(monthsSince / 12);
      const remainingMonths = monthsSince % 12;

      // Calculate tier from duration
      let tier = 'Copper';
      if (monthsSince >= 72) tier = 'Unobtainium';
      else if (monthsSince >= 60) tier = 'Amethyst';
      else if (monthsSince >= 36) tier = 'Sapphire';
      else if (monthsSince >= 24) tier = 'Diamond';
      else if (monthsSince >= 12) tier = 'Platinum';
      else if (monthsSince >= 6) tier = 'Gold';
      else if (monthsSince >= 3) tier = 'Silver';

      let durationText = '';
      if (yearsSince > 0) {
        durationText = yearsSince === 1
          ? `1 year${remainingMonths > 0 ? ` ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`
          : `${yearsSince} years${remainingMonths > 0 ? ` ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`;
      } else {
        durationText = monthsSince === 1 ? '1 month' : `${monthsSince} months`;
      }

      const tooltipText = `${tier} Supporter${durationText ? ` - ${durationText}` : ''}`;

      // Click outside to dismiss
      useEffect(() => {
        if (!showTooltip) return;
        const handleClickOutside = (e) => {
          if (badgeRef.current && !badgeRef.current.contains(e.target)) {
            setShowTooltip(false);
          }
        };
        document.addEventListener('click', handleClickOutside, true);
        return () => document.removeEventListener('click', handleClickOutside, true);
      }, [showTooltip]);

      // Color schemes for each tier
      const tierColors = {
        Copper: { primary: '#b87333', secondary: '#da8a67', accent: '#e8a878', dark: '#8b4513' },
        Silver: { primary: '#c0c0c0', secondary: '#cd7f32', accent: '#d8d8d8', dark: '#808080' },
        Gold: { primary: '#ffd700', secondary: '#ffb800', accent: '#ffed4e', dark: '#b8860b' },
        Platinum: { primary: '#00bcd4', secondary: '#ffd700', accent: '#4dd0e1', dark: '#0097a7' },
        Diamond: { primary: '#9c27b0', secondary: '#7b1fa2', accent: '#ce93d8', dark: '#6a1b9a' },
        Sapphire: { primary: '#1565c0', secondary: '#9c27b0', accent: '#42a5f5', dark: '#0d47a1' },
        Amethyst: { primary: '#7b1fa2', secondary: '#4a148c', accent: '#ba68c8', dark: '#4a148c' },
        Unobtainium: { primary: '#00fff7', secondary: '#ff00ff', accent: '#ffff00', dark: '#0a0a1a' }
      };

      const colors = tierColors[tier];

      // Helper to create the core location pin
      const createPin = (tierName) => {
        const c = tierColors[tierName];
        return [
          H('path', {
            key: 'pin-body',
            d: 'M50 20 C35 20 25 32 25 45 C25 58 50 80 50 80 C50 80 75 58 75 45 C75 32 65 20 50 20 Z',
            fill: `url(#pinGrad-${tierName})`,
            stroke: c.dark,
            strokeWidth: '2'
          }),
          H('circle', { key: 'pin-circle', cx: '50', cy: '42', r: '14', fill: c.accent, stroke: c.dark, strokeWidth: '1.5' }),
          H('text', {
            key: 'pin-t',
            x: '50',
            y: '47',
            textAnchor: 'middle',
            fontSize: '12',
            fontWeight: 'bold',
            fill: c.dark,
            opacity: '0.25'
          }, 'T')
        ];
      };

      // Badge SVGs for each tier
      const getBadgeSVG = () => {
        // Copper: Shield frame with scrollwork (same design as Silver/Gold but copper colors with shine)
        if (tier === 'Copper') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Copper', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('linearGradient', { id: 'copperShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#e8a878' }),
                H('stop', { offset: '30%', stopColor: '#da8a67' }),
                H('stop', { offset: '70%', stopColor: '#b87333' }),
                H('stop', { offset: '100%', stopColor: '#8b4513' })
              ),
              H('linearGradient', { id: 'copperShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
                H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
                H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
              ),
              H('clipPath', { id: 'copperShieldClip' },
                H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
              )
            ),
            H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#copperShield)', strokeWidth: '3' }),
            H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
            H('g', { clipPath: 'url(#copperShieldClip)' },
              H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#copperShine)', transform: 'rotate(20)' },
                H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
              )
            ),
            H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
            H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
            H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
            ...createPin('Copper')
          );
        }

        // Silver: Shield frame with elegant scrollwork, feathers, and shine flash
        if (tier === 'Silver') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Silver', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('linearGradient', { id: 'silverShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#ffffff' }),
                H('stop', { offset: '30%', stopColor: '#e8e8e8' }),
                H('stop', { offset: '70%', stopColor: '#c0c0c0' }),
                H('stop', { offset: '100%', stopColor: '#a0a0a0' })
              ),
              H('linearGradient', { id: 'silverShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
                H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
                H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
              ),
              H('clipPath', { id: 'silverShieldClip' },
                H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
              )
            ),
            H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#silverShield)', strokeWidth: '3' }),
            H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
            H('g', { clipPath: 'url(#silverShieldClip)' },
              H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#silverShine)', transform: 'rotate(20)' },
                H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
              )
            ),
            H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
            H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
            H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
            ...createPin('Silver')
          );
        }

        // Gold: Shield frame with scrollwork (same as Silver but gold colors with shine)
        if (tier === 'Gold') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Gold', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('linearGradient', { id: 'goldShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#fff9e6' }),
                H('stop', { offset: '30%', stopColor: '#ffed4e' }),
                H('stop', { offset: '70%', stopColor: '#ffd700' }),
                H('stop', { offset: '100%', stopColor: '#b8860b' })
              ),
              H('linearGradient', { id: 'goldShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
                H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
                H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
                H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
              ),
              H('clipPath', { id: 'goldShieldClip' },
                H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
              )
            ),
            H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#goldShield)', strokeWidth: '3' }),
            H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
            H('g', { clipPath: 'url(#goldShieldClip)' },
              H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#goldShine)', transform: 'rotate(20)' },
                H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
              )
            ),
            H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
            H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
            H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
            H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
            H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
            H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
            ...createPin('Gold')
          );
        }

        // Platinum: Crown on top with orbital rings
        if (tier === 'Platinum') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Platinum', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              )
            ),
            H('ellipse', { cx: '50', cy: '50', rx: '46', ry: '20', fill: 'none', stroke: colors.primary, strokeWidth: '1.5', opacity: '0.4', transform: 'rotate(-20 50 50)' }),
            H('ellipse', { cx: '50', cy: '50', rx: '46', ry: '20', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.3', transform: 'rotate(20 50 50)' }),
            H('path', { d: 'M35 12 L38 4 L44 10 L50 2 L56 10 L62 4 L65 12 L62 14 L38 14 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.8' }),
            H('circle', { cx: '50', cy: '5', r: '2', fill: colors.accent }),
            H('circle', { cx: '38', cy: '7', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '62', cy: '7', r: '1.5', fill: colors.accent }),
            H('g', { className: 'badge-rotate-slow', style: { transformOrigin: '50px 50px' } },
              H('circle', { cx: '50', cy: '4', r: '2', fill: colors.primary }),
              H('circle', { cx: '96', cy: '50', r: '2', fill: colors.accent }),
              H('circle', { cx: '50', cy: '96', r: '2', fill: colors.primary }),
              H('circle', { cx: '4', cy: '50', r: '2', fill: colors.accent })
            ),
            H('circle', { cx: '50', cy: '52', r: '35', fill: 'none', stroke: colors.secondary, strokeWidth: '2', opacity: '0.5' }),
            ...createPin('Platinum')
          );
        }

        // Diamond: Classic brilliant cut gem with sparkle
        if (tier === 'Diamond') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Diamond', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('linearGradient', { id: 'diamondGem', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#ffffff' }),
                H('stop', { offset: '40%', stopColor: '#f3e5f5' }),
                H('stop', { offset: '100%', stopColor: '#ce93d8' })
              ),
              H('linearGradient', { id: 'diamondFacetL', x1: '100%', y1: '0%', x2: '0%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#ea80fc' }),
                H('stop', { offset: '100%', stopColor: '#e040fb' })
              ),
              H('linearGradient', { id: 'diamondFacetR', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#f3e5f5' }),
                H('stop', { offset: '100%', stopColor: '#aa00ff' })
              ),
              H('radialGradient', { id: 'diamondGlow', cx: '50%', cy: '30%', r: '60%' },
                H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0.4' }),
                H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
              )
            ),
            H('circle', { cx: '50', cy: '50', r: '46', fill: 'url(#diamondGlow)' }),
            H('circle', { cx: '50', cy: '50', r: '46', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
            H('polygon', { points: '50,8 30,28 50,35 70,28', fill: 'url(#diamondGem)', stroke: colors.dark, strokeWidth: '0.8' }),
            H('polygon', { points: '30,28 20,45 50,35', fill: 'url(#diamondFacetL)', stroke: colors.dark, strokeWidth: '0.5' }),
            H('polygon', { points: '70,28 80,45 50,35', fill: 'url(#diamondFacetR)', stroke: colors.dark, strokeWidth: '0.5' }),
            H('polygon', { points: '20,45 50,85 50,35', fill: 'url(#diamondFacetL)', stroke: colors.dark, strokeWidth: '0.5' }),
            H('polygon', { points: '80,45 50,85 50,35', fill: 'url(#diamondFacetR)', stroke: colors.dark, strokeWidth: '0.5' }),
            H('path', { d: 'M20 45 L80 45', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
            H('circle', { cx: '50', cy: '8', r: '2.5', fill: '#ffffff' }),
            H('circle', { cx: '35', cy: '22', r: '1.5', fill: '#ffffff', opacity: '0.8' }),
            H('circle', { cx: '65', cy: '22', r: '1.5', fill: '#ffffff', opacity: '0.8' }),
            H('circle', { cx: '50', cy: '28', r: '2', fill: '#ffffff', opacity: '0.6' }),
            H('path', { d: 'M50 4 L50 0', fill: 'none', stroke: '#ffffff', strokeWidth: '1.5', strokeLinecap: 'round' }),
            H('path', { d: 'M42 6 L38 2', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round' }),
            H('path', { d: 'M58 6 L62 2', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round' }),
            H('circle', { cx: '15', cy: '50', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '85', cy: '50', r: '1.5', fill: colors.accent }),
            H('circle', { cx: '50', cy: '95', r: '1.5', fill: colors.accent }),
            ...createPin('Diamond')
          );
        }

        // Sapphire: Night sky constellation - stars connected in a unique pattern
        if (tier === 'Sapphire') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Sapphire', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('radialGradient', { id: 'sapphireNight', cx: '50%', cy: '50%', r: '50%' },
                H('stop', { offset: '0%', stopColor: '#1565c0', stopOpacity: '0.3' }),
                H('stop', { offset: '100%', stopColor: '#0d47a1', stopOpacity: '0.1' })
              )
            ),
            H('circle', { cx: '50', cy: '50', r: '46', fill: 'url(#sapphireNight)' }),
            H('circle', { cx: '50', cy: '50', r: '46', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
            H('circle', { cx: '50', cy: '50', r: '43', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.3' }),
            H('path', { d: 'M20 25 L35 40 L50 20 L70 35 L85 22', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
            H('path', { d: 'M35 40 L25 60 L45 75', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
            H('path', { d: 'M70 35 L80 55 L65 70 L45 75', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
            H('path', { d: 'M50 20 L55 45 L70 35', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round', opacity: '0.4' }),
            H('circle', { cx: '20', cy: '25', r: '3', fill: colors.accent }),
            H('circle', { cx: '35', cy: '40', r: '3.5', fill: '#ffffff' }),
            H('circle', { cx: '50', cy: '20', r: '4', fill: colors.accent }),
            H('circle', { cx: '70', cy: '35', r: '3', fill: '#ffffff' }),
            H('circle', { cx: '85', cy: '22', r: '2.5', fill: colors.accent }),
            H('circle', { cx: '25', cy: '60', r: '2.5', fill: colors.primary }),
            H('circle', { cx: '45', cy: '75', r: '3.5', fill: colors.accent }),
            H('circle', { cx: '80', cy: '55', r: '2.5', fill: '#ffffff' }),
            H('circle', { cx: '65', cy: '70', r: '3', fill: colors.primary }),
            H('circle', { cx: '55', cy: '45', r: '2', fill: colors.accent }),
            H('circle', { cx: '12', cy: '45', r: '1', fill: colors.accent, opacity: '0.5' }),
            H('circle', { cx: '88', cy: '42', r: '1', fill: colors.accent, opacity: '0.5' }),
            H('circle', { cx: '15', cy: '80', r: '1', fill: '#ffffff', opacity: '0.4' }),
            H('circle', { cx: '90', cy: '75', r: '1', fill: '#ffffff', opacity: '0.4' }),
            H('circle', { cx: '40', cy: '12', r: '1', fill: colors.accent, opacity: '0.5' }),
            H('circle', { cx: '75', cy: '85', r: '1', fill: colors.primary, opacity: '0.4' }),
            H('circle', { cx: '30', cy: '88', r: '1', fill: colors.accent, opacity: '0.5' }),
            H('circle', { cx: '60', cy: '8', r: '1', fill: '#ffffff', opacity: '0.4' }),
            ...createPin('Sapphire')
          );
        }

        // Amethyst: Gothic cathedral arch frame with hanging crystals
        if (tier === 'Amethyst') {
          return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
            H('defs', null,
              H('linearGradient', { id: 'pinGrad-Amethyst', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: colors.accent }),
                H('stop', { offset: '50%', stopColor: colors.primary }),
                H('stop', { offset: '100%', stopColor: colors.secondary })
              ),
              H('linearGradient', { id: 'amethystArch', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                H('stop', { offset: '0%', stopColor: '#e1bee7' }),
                H('stop', { offset: '50%', stopColor: '#9c27b0' }),
                H('stop', { offset: '100%', stopColor: '#4a148c' })
              ),
              H('radialGradient', { id: 'amethystGlow', cx: '50%', cy: '40%', r: '50%' },
                H('stop', { offset: '0%', stopColor: colors.accent, stopOpacity: '0.35' }),
                H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
              )
            ),
            H('circle', { cx: '50', cy: '50', r: '42', fill: 'url(#amethystGlow)' }),
            H('path', { d: 'M15 85 L15 40 Q15 10 50 4 Q85 10 85 40 L85 85', fill: 'none', stroke: 'url(#amethystArch)', strokeWidth: '3', strokeLinecap: 'round' }),
            H('path', { d: 'M20 82 L20 42 Q20 16 50 10 Q80 16 80 42 L80 82', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.4' }),
            H('path', { d: 'M50 2 L56 10 L50 18 L44 10 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
            H('path', { d: 'M50 2 L50 18 L44 10 Z', fill: colors.accent, opacity: '0.4' }),
            H('path', { d: 'M25 20 L25 30', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
            H('path', { d: 'M25 30 L28 38 L25 46 L22 38 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.3' }),
            H('circle', { cx: '25', cy: '20', r: '2', fill: colors.accent }),
            H('path', { d: 'M75 20 L75 30', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
            H('path', { d: 'M75 30 L78 38 L75 46 L72 38 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.3' }),
            H('circle', { cx: '75', cy: '20', r: '2', fill: colors.accent }),
            H('circle', { cx: '10', cy: '55', r: '3', fill: 'none', stroke: colors.primary, strokeWidth: '1.5' }),
            H('circle', { cx: '10', cy: '55', r: '1', fill: colors.accent }),
            H('circle', { cx: '90', cy: '55', r: '3', fill: 'none', stroke: colors.primary, strokeWidth: '1.5' }),
            H('circle', { cx: '90', cy: '55', r: '1', fill: colors.accent }),
            H('path', { d: 'M30 88 Q40 82 50 88 Q60 94 70 88', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
            H('path', { d: 'M25 92 L30 88 M75 92 L70 88', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round' }),
            H('circle', { cx: '50', cy: '95', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
            H('circle', { cx: '35', cy: '12', r: '1.5', fill: colors.accent, className: 'badge-sparkle-particle' }),
            H('circle', { cx: '65', cy: '12', r: '1.5', fill: colors.accent, className: 'badge-sparkle-particle' }),
            ...createPin('Amethyst')
          );
        }

        // Unobtainium: Cosmic starburst with dragon coils, nebula colors, and legendary grandeur
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Unobtainium', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#eceff1' }),
              H('stop', { offset: '30%', stopColor: '#b0bec5' }),
              H('stop', { offset: '60%', stopColor: '#cfd8dc' }),
              H('stop', { offset: '100%', stopColor: '#90a4ae' })
            ),
            H('linearGradient', { id: 'unobtainiumNebula1', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#ff6b9d' }),
              H('stop', { offset: '100%', stopColor: '#c44569' })
            ),
            H('linearGradient', { id: 'unobtainiumNebula2', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#4fc3f7' }),
              H('stop', { offset: '100%', stopColor: '#0288d1' })
            ),
            H('linearGradient', { id: 'unobtainiumNebula3', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#aed581' }),
              H('stop', { offset: '100%', stopColor: '#7cb342' })
            ),
            H('linearGradient', { id: 'unobtainiumGold', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#ffd54f' }),
              H('stop', { offset: '50%', stopColor: '#ffb300' }),
              H('stop', { offset: '100%', stopColor: '#ff8f00' })
            ),
            H('linearGradient', { id: 'unobtainiumDragon', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#e0e0e0' }),
              H('stop', { offset: '50%', stopColor: '#9e9e9e' }),
              H('stop', { offset: '100%', stopColor: '#616161' })
            ),
            H('radialGradient', { id: 'unobtainiumCore', cx: '50%', cy: '50%', r: '50%' },
              H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0.7' }),
              H('stop', { offset: '40%', stopColor: '#e1bee7', stopOpacity: '0.3' }),
              H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
            )
          ),
          H('circle', { cx: '50', cy: '50', r: '48', fill: 'url(#unobtainiumCore)' }),
          H('path', { d: 'M50 2 L52 20 L50 18 L48 20 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
          H('path', { d: 'M50 98 L48 80 L50 82 L52 80 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
          H('path', { d: 'M2 50 L20 48 L18 50 L20 52 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
          H('path', { d: 'M98 50 L80 52 L82 50 L80 48 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
          H('path', { d: 'M15 15 L28 25 L26 26 L25 28 Z', fill: colors.accent, opacity: '0.6' }),
          H('path', { d: 'M85 15 L72 25 L74 26 L75 28 Z', fill: colors.accent, opacity: '0.6' }),
          H('path', { d: 'M15 85 L28 75 L26 74 L25 72 Z', fill: colors.accent, opacity: '0.6' }),
          H('path', { d: 'M85 85 L72 75 L74 74 L75 72 Z', fill: colors.accent, opacity: '0.6' }),
          H('path', { d: 'M8 35 Q2 42 6 50 Q2 58 8 65 Q14 58 10 50 Q14 42 8 35', fill: 'url(#unobtainiumNebula1)', stroke: '#c44569', strokeWidth: '0.5' }),
          H('path', { d: 'M12 30 Q4 40 8 50 Q4 60 12 70', fill: 'none', stroke: '#ff6b9d', strokeWidth: '1.5', strokeLinecap: 'round' }),
          H('circle', { cx: '6', cy: '32', r: '2', fill: '#ff6b9d' }),
          H('path', { d: 'M92 35 Q98 42 94 50 Q98 58 92 65 Q86 58 90 50 Q86 42 92 35', fill: 'url(#unobtainiumNebula2)', stroke: '#0288d1', strokeWidth: '0.5' }),
          H('path', { d: 'M88 30 Q96 40 92 50 Q96 60 88 70', fill: 'none', stroke: '#4fc3f7', strokeWidth: '1.5', strokeLinecap: 'round' }),
          H('circle', { cx: '94', cy: '32', r: '2', fill: '#4fc3f7' }),
          H('circle', { cx: '50', cy: '50', r: '36', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
          H('circle', { cx: '50', cy: '50', r: '33', fill: 'none', stroke: 'url(#unobtainiumGold)', strokeWidth: '1', strokeDasharray: '4 2' }),
          H('path', { d: 'M32 12 L35 4 L42 8 L50 0 L58 8 L65 4 L68 12 L65 15 L35 15 Z', fill: 'url(#unobtainiumDragon)', stroke: colors.dark, strokeWidth: '0.5' }),
          H('circle', { cx: '50', cy: '3', r: '3.5', fill: 'url(#unobtainiumGold)', stroke: '#ff8f00', strokeWidth: '0.5' }),
          H('circle', { cx: '42', cy: '7', r: '2', fill: 'url(#unobtainiumNebula1)' }),
          H('circle', { cx: '58', cy: '7', r: '2', fill: 'url(#unobtainiumNebula2)' }),
          H('circle', { cx: '35', cy: '9', r: '1.5', fill: 'url(#unobtainiumNebula3)' }),
          H('circle', { cx: '65', cy: '9', r: '1.5', fill: 'url(#unobtainiumGold)' }),
          H('path', { d: 'M35 88 Q42 84 50 88 Q58 92 65 88', fill: 'none', stroke: 'url(#unobtainiumNebula3)', strokeWidth: '2.5', strokeLinecap: 'round' }),
          H('path', { d: 'M40 92 Q50 96 60 92', fill: 'none', stroke: 'url(#unobtainiumGold)', strokeWidth: '1.5', strokeLinecap: 'round' }),
          H('circle', { cx: '50', cy: '96', r: '3', fill: 'url(#unobtainiumGold)', stroke: '#ff8f00', strokeWidth: '0.5' }),
          H('path', { d: 'M22 22 L26 18 L30 22 L26 26 Z', fill: 'url(#unobtainiumNebula1)', className: 'badge-sparkle-particle' }),
          H('path', { d: 'M78 22 L74 18 L70 22 L74 26 Z', fill: 'url(#unobtainiumNebula2)', className: 'badge-sparkle-particle' }),
          H('path', { d: 'M22 78 L26 74 L30 78 L26 82 Z', fill: 'url(#unobtainiumNebula3)', className: 'badge-sparkle-particle' }),
          H('path', { d: 'M78 78 L74 74 L70 78 L74 82 Z', fill: 'url(#unobtainiumGold)', className: 'badge-sparkle-particle' }),
          H('g', { className: 'badge-rotate-slow', style: { transformOrigin: '50px 50px' } },
            H('circle', { cx: '50', cy: '6', r: '2', fill: '#ffd54f' }),
            H('circle', { cx: '94', cy: '50', r: '2', fill: '#4fc3f7' }),
            H('circle', { cx: '50', cy: '94', r: '2', fill: '#aed581' }),
            H('circle', { cx: '6', cy: '50', r: '2', fill: '#ff6b9d' })
          ),
          ...createPin('Unobtainium')
        );
      };

      const glowColors = {
        Copper: 'rgba(184, 115, 51, 0.6)',
        Silver: 'rgba(192, 192, 192, 0.6)',
        Gold: 'rgba(255, 215, 0, 0.6)',
        Platinum: 'rgba(0, 188, 212, 0.6)',
        Diamond: 'rgba(156, 39, 176, 0.6)',
        Sapphire: 'rgba(21, 101, 192, 0.6)',
        Amethyst: 'rgba(123, 31, 162, 0.6)',
        Unobtainium: 'rgba(0, 255, 247, 0.8)'
      };

      const handleClick = (e) => {
        e.stopPropagation();
        setShowTooltip(true);
        if (onClick) onClick(e);
      };

      return H('div', {
        ref: badgeRef,
        style: { display: 'inline-flex', position: 'relative', cursor: 'pointer' },
        onClick: handleClick
      },
        H('div', {
          className: `supporter-tier-badge supporter-tier-badge--${tier.toLowerCase()}`,
          title: tooltipText,
          style: showTooltip ? { transform: 'scale(1.25)', transition: 'transform 0.15s ease' } : { transition: 'transform 0.15s ease' }
        },
          getBadgeSVG()
        ),
        showTooltip && H('div', {
          style: {
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            background: 'rgba(0, 0, 0, 0.9)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            zIndex: 1000,
            pointerEvents: 'none',
            border: `1px solid ${glowColors[tier]}`
          }
        }, tooltipText)
      );
    }

    async function fetchCoordsAndReverseInternal({ silent = true } = {}) {
      if (typeof fetchCoordsAndReverse === 'function') {
        return fetchCoordsAndReverse({ silent });
      }

      let lat, lon;
      // Use Capacitor Geolocation on native, browser API on web
      const isNative = window.Capacitor?.isNativePlatform?.();
      if (isNative && window.Capacitor?.Plugins?.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 60000
        });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
      } else {
        if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
        const { coords } = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
        );
        lat = coords.latitude;
        lon = coords.longitude;
      }
      const r = await api.reverseGeocode(lat, lon, { silent });
      const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      return {
        lat: r?.lat ?? lat,
        lon: r?.lon ?? lon,
        display: formatLocationDisplay(r, fallback)
      };
    }

    // --- MultiFilePicker (for S3 uploads) ---
    function MultiFilePicker({ files, onChange }) {
      const ref = useRef();
      const MAX_MB = 20;
      const previews = useFilePreviews(files);

      function pick(e) {
        const selected = Array.from(e.target.files || []);
        const next = [...files];
        for (const f of selected) {
          if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
          if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
          next.push(f);
        }
        onChange(next);
        if (ref.current) ref.current.value = '';
      }
      function removeAt(i) {
        const next = [...files];
        const [removed] = next.splice(i, 1);
        if (removed) clearDraftCacheForFile(removed);
        onChange(next);
      }

      return H('div', null,
        H('div', { className: 'row' },
          H('input', { type: 'file', accept: 'image/*', multiple: true, ref, onChange: pick }),
          H('span', { className: 'muted' }, `${(files || []).length} file(s)`)
        ),
        H('div', { className: 'row', style: { flexWrap: 'wrap', gap: 8, marginTop: 8 } },
          ...previews.map(({ url }, i) => H('div', { key: i, style: { position: 'relative' } },
            H(ImageWithSkeleton, {
              src: url,
              style: { width: 96, height: 96, objectFit: 'cover', borderRadius: 12, border: '1px solid #ddd' }
            }),
            H('button', { className: 'btn danger', type: 'button', style: { position: 'absolute', top: 4, right: 4, padding: '4px 8px' }, onClick: () => removeAt(i) }, 'x')
          ))
        )
      );
    }

    // --- Shared help modal shell (high-contrast layout) ---
    function InfoHelpModal({ title, intro, bullets, footer, onClose }) {
      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); },
          style: { background: 'rgba(0,0,0,0.5)' }
        },
          H('div', {
            className: 'modal-inner',
            style: {
              display: 'block',
              width: 'min(520px, 92vw)',
              background: '#111',
              color: '#fff',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 16px 48px rgba(0,0,0,.45)',
              lineHeight: 1.55,
              position: 'relative'
            }
          },
            H('button', {
              type: 'button',
              onClick: onClose,
              'aria-label': 'Close',
              style: {
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '44px',
                height: '44px',
                fontSize: '32px',
                lineHeight: '32px',
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: '#fff', cursor: 'pointer',
                fontWeight: 'bold'
              }
            }, '✕'),
            H('div', { style: { paddingTop: '28px', fontWeight: 800, fontSize: 16, marginBottom: 8 } }, title),
            H('div', null,
              intro && H('p', { style: { margin: '6px 0 10px', opacity: 0.9 } }, intro),
              Array.isArray(bullets) && bullets.length > 0 && H('ul', {
                style: {
                  paddingLeft: 18,
                  margin: '0 0 12px',
                  listStyle: 'disc'
                }
              }, bullets.map((line, idx) => H('li', { key: idx }, line))),
              footer && H('div', {
                style: {
                  fontSize: 13,
                  opacity: 0.9,
                  borderTop: '1px solid rgba(255,255,255,0.12)',
                  paddingTop: 10
                }
              }, footer)
            )
          )
        ),
        document.body
      );
    }

    // --- Auto-list help modal (clean single-column layout) ---
    function AutoListHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'About Auto-list',
        intro: 'When enabled, Auto-List will:',
        bullets: [
          'Allow AI to suggest title, tags and price .',
          'Immediately create the listing for you.',
          'Upload all selected photos to that listing.'
        ],
        footer: 'You can still edit or delete the listing afterwards.'
      });
    }

    function InquiryHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Offer Message',
        intro: 'When Offer is enabled it will:',
        bullets: [
          'Overlay the listing image with a message inviting buyers to make an offer.'
        ],
        footer: 'Disable Offer Message to allow only the price.'
      });
    }

    // --- Listing Form (S3-first) - Modern design matching mobile ---
    function ListingForm({ draft, onCancel, onSaved, autoListEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, reloadMine, reloadAll, initialFiles = [], onModerationError, isPremium = false, onOpenPremiumModal }) {
      const [files, setFiles] = useState(() => Array.isArray(initialFiles) ? initialFiles.slice() : []); // Files to upload to S3
      const [existingUrls, setExistingUrls] = useState([]); // Show current images (editable)
      const [originalUrls, setOriginalUrls] = useState([]);

      const [title, setTitle] = useState(draft?.title || '');
      const [description, setDescription] = useState(draft?.description || '');
      const [location, setLocation] = useState(draft?.location || '');
      const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
      const [tags, setTags] = useState(() => {
        if (!draft?.tags) return '';
        if (Array.isArray(draft.tags)) return draft.tags.join(', ');
        return String(draft.tags);
      });
      const [customTag, setCustomTag] = useState(draft?.custom_tag || '');
      const [customTagColor, setCustomTagColor] = useState(draft?.custom_tag_color || '#6366f1');

      const TAG_COLORS = [
        { hex: '#6366f1', name: 'Indigo' },
        { hex: '#8b5cf6', name: 'Purple' },
        { hex: '#ec4899', name: 'Pink' },
        { hex: '#ef4444', name: 'Red' },
        { hex: '#f97316', name: 'Orange' },
        { hex: '#eab308', name: 'Yellow' },
        { hex: '#22c55e', name: 'Green' },
        { hex: '#06b6d4', name: 'Cyan' },
        { hex: '#3b82f6', name: 'Blue' },
        { hex: '#64748b', name: 'Slate' }
      ];

      const [aiBusy, setAiBusy] = useState(false);
      const [aiErr, setAiErr] = useState('');
      const [aiCooldown, setAiCooldown] = useState(0); // seconds remaining

      // auto-list guard
      const autoRunning = useRef(false);
      const [autoBusy, setAutoBusy] = useState(false);
      const [saving, setSaving] = useState(false);
      const [showModerationModal, setShowModerationModal] = useState(false);

      const hasFixedGps = !!draft?.lat;
      const [enableNearby, setEnableNearby] = useState(!!draft?.enable_nearby);
      const [geoBusy, setGeoBusy] = useState(false);
      const [geoErr, setGeoErr] = useState('');

      const [lat, setLat] = useState(draft?.lat ?? null);
      const [lon, setLon] = useState(draft?.lon ?? null);

      const [inquiryEnabled, setInquiryEnabled] = useState(() => {
        if (draft?.inquiry_enabled != null) return !!draft.inquiry_enabled;
        if (typeof autoInquiryEnabled === 'boolean') return autoInquiryEnabled;
        return !!autoListEnabled;
      });
      const [showInquiryHelp, setShowInquiryHelp] = useState(false);
      const [markedFree, setMarkedFree] = useState(() => !!draft?.is_free);

      const isMobile = isMobileDevice();

      // Touch-friendly input style (matching mobile)
      const INPUT_STYLE = {
        padding: '14px 16px',
        fontSize: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        background: '#fff',
        width: '100%',
        boxSizing: 'border-box'
      };

      useEffect(() => {
        if (!Array.isArray(initialFiles)) return;
        if (initialFiles.length === 0) {
          setFiles([]);
          return;
        }
        setFiles(initialFiles.slice());
      }, [initialFiles]);

      // Load current images only when draft.id changes (separate effect to avoid
      // re-fetching when autoListEnabled/autoInquiryEnabled change)
      useEffect(() => {
        (async () => {
          if (draft?.id) {
            try {
              const arr = await api.getListingImages(draft.id);
              setExistingUrls(arr || []);
              setOriginalUrls(arr || []);
            }
            catch {
              setExistingUrls([]);
              setOriginalUrls([]);
            }
          } else {
            setExistingUrls([]);
            setOriginalUrls([]);
          }
        })();
      }, [draft?.id]);

      // Set inquiry default only for new listings
      useEffect(() => {
        if (!draft?.id) {
          if (!autoListEnabled) {
            setInquiryEnabled(false);
          } else if (typeof autoInquiryEnabled === 'boolean') {
            setInquiryEnabled(autoInquiryEnabled);
          } else {
            setInquiryEnabled(true);
          }
        }
      }, [draft?.id, autoListEnabled, autoInquiryEnabled]);

      // Cooldown timer effect
      useEffect(() => {
        if (aiCooldown <= 0) return;
        const timer = setTimeout(() => setAiCooldown(c => c - 1), 1000);
        return () => clearTimeout(timer);
      }, [aiCooldown]);

      async function runAI() {
        if (aiCooldown > 0) return;
        setAiErr('');
        setAiBusy(true);
        try {
          const sources = [];

          if (files.length) {
            for (const file of files) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              try {
                const upload = await uploadFileDraft(file);
                if (upload?.publicUrl) sources.push(upload.publicUrl);
              } catch (err) {
                console.error('AI draft upload failed:', err);
              }
            }
          }

          if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
            for (const url of existingUrls) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              if (typeof url === 'string' && url.trim()) {
                sources.push(url);
              }
            }
          }

          if (!sources.length) {
            alert('No images available for AI analysis.');
            return;
          }

          // Don't send existing title/description as hint - it biases AI toward old content
          const res = await api.aiAnalyze({
            images: sources.slice(0, AI_IMAGE_LIMIT),
            hint: ''
          });

          if (res.title) setTitle(res.title);
          if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
          if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
            setPriceVal(String(res.suggested_price));
          }
          // AI descriptions disabled
        } catch (e) {
          setAiErr(e.message || 'AI failed');
        } finally {
          setAiBusy(false);
          setAiCooldown(20); // 20 second cooldown (3 per minute)
        }
      }

      async function useMyLocation() {
        setGeoErr('');
        setGeoBusy(true);
        try {
          let coords;
          // Use Capacitor Geolocation on native, browser API on web
          const isNative = window.Capacitor?.isNativePlatform?.();
          if (isNative && window.Capacitor?.Plugins?.Geolocation) {
            const { Geolocation } = window.Capacitor.Plugins;
            const position = await Geolocation.getCurrentPosition({
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 60000
            });
            coords = { lat: position.coords.latitude, lon: position.coords.longitude };
          } else {
            if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); setGeoBusy(false); return; }
            coords = await new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(
                p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
                err => rej(err),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
              )
            );
          }
          const r = await api.reverseGeocode(coords.lat, coords.lon);
          const fallback = `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
          setLocation(formatLocationDisplay(r, fallback));
          setLat(r?.lat ?? coords.lat);
          setLon(r?.lon ?? coords.lon);
        } catch { setGeoErr('Could not get your location'); }
        finally { setGeoBusy(false); }
      }

      // Auto-list effect - uses fire-and-forget API for durable background processing
      const mountedRef = useRef(true);
      useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
      }, []);

      useEffect(() => {
        if (!autoListEnabled) return;
        if (draft) return;
        if (!files || files.length === 0) return;
        if (autoRunning.current) return;

        autoRunning.current = true;

        // Fire-and-forget auto-list: upload images, then enqueue server-side job
        // Use setTimeout to avoid blocking the main thread on mobile
        setTimeout(async () => {
          try {
            console.log('[ListingForm AutoList] Starting fire-and-forget flow with', files.length, 'files');

            // Step 1: Upload all images to get upload tokens
            const uploadResults = await Promise.allSettled(files.map(uploadFileDraft));
            const uploads = uploadResults
              .filter(r => r.status === 'fulfilled' && r.value?.uploadToken)
              .map(r => r.value);

            if (!uploads.length) {
              // Check if any upload failed with a validation/moderation error
              const firstError = uploadResults.find(r => r.status === 'rejected');
              const errMsg = firstError?.reason?.message || firstError?.reason || 'No images uploaded successfully';
              throw new Error(errMsg);
            }

            const uploadTokens = uploads.map((u) => u.uploadToken).filter(Boolean);
            console.log('[ListingForm AutoList] Got', uploadTokens.length, 'upload tokens');

            // Step 2: Get location (for server-side use)
            const manualLocation = String(location || '').trim();
            let locAuto = manualLocation;
            let latAuto = null;
            let lonAuto = null;
            let enableNearbyAuto = false;

            if (autoPostNearbyEnabled) {
              try {
                const c = await fetchCoordsAndReverseInternal();
                if (c && c.lat != null && c.lon != null) {
                  enableNearbyAuto = true;
                  latAuto = c.lat;
                  lonAuto = c.lon;
                  if (!locAuto) locAuto = formatLocationDisplay(c, c?.display || '');
                }
              } catch (e) {
                console.warn('[ListingForm AutoList] Nearby coords failed:', e);
              }
            }

            if (!locAuto) {
              try {
                const c = await fetchCoordsAndReverseInternal();
                if (c) {
                  locAuto = formatLocationDisplay(c, c?.display || '');
                }
              } catch (_) { }
            }

            if (!locAuto) {
              locAuto = 'Unknown location';
            }

            // Step 3: Build fire-and-forget payload
            const payload = {
              upload_tokens: uploadTokens,
              location: locAuto,
              hint: '', // Could include user hints in future
              ai_enabled: true, // Always analyze for title/tags/price
              enable_nearby: enableNearbyAuto,
              inquiry_enabled: !!inquiryEnabled
            };

            if (enableNearbyAuto && latAuto != null && lonAuto != null) {
              payload.lat = latAuto;
              payload.lon = lonAuto;
            }

            // Step 4: Call fire-and-forget API
            console.log('[ListingForm AutoList] Calling createAutoListing');

            if (typeof api.createAutoListing !== 'function') {
              throw new Error('createAutoListing API not available');
            }

            const result = await api.createAutoListing(payload);

            if (!result?.job_id) {
              console.error('[ListingForm AutoList] No job_id in response:', result);
              throw new Error('Failed to enqueue auto-listing job');
            }

            console.log('[ListingForm AutoList] Job enqueued:', result.job_id);

            // Show toast NOW - data is on server, user can close app
            if (typeof enqueueListingJob === 'function') {
              try { enqueueListingJob(async () => {}); } catch (e) { /* ignore */ }
            }

            // Close the form immediately - user doesn't need to wait
            if (mountedRef.current) {
              try { onCancel?.(); } catch (e) { console.warn('[ListingForm AutoList] onCancel error:', e); }
            }

            // Poll for job completion, then refresh listings
            if (typeof api.getAutoListingStatus === 'function') {
              const pollForCompletion = async () => {
                let attempts = 0;
                const maxAttempts = 30; // 1 minute max
                const intervalMs = 2000;

                const poll = async () => {
                  if (attempts >= maxAttempts) {
                    console.warn('[ListingForm AutoList] Polling timed out');
                    return;
                  }
                  attempts++;

                  try {
                    const status = await api.getAutoListingStatus(result.job_id, { silent: true });
                    if (status?.status === 'completed') {
                      console.log('[ListingForm AutoList] Job completed, refreshing listings');
                      // Refresh listings to show the new item with full seller data
                      try { await reloadMine?.(); } catch (e) { /* ignore */ }
                      try { await reloadAll?.(); } catch (e) { /* ignore */ }
                      // Now notify that save is complete
                      try { onSaved?.(); } catch (e) { console.warn('[ListingForm AutoList] onSaved error:', e); }
                      return;
                    } else if (status?.status === 'failed') {
                      console.error('[ListingForm AutoList] Job failed:', status.error);
                      return;
                    }
                    // Still pending, poll again
                    setTimeout(poll, intervalMs);
                  } catch (e) {
                    console.warn('[ListingForm AutoList] Poll error:', e);
                    setTimeout(poll, intervalMs);
                  }
                };

                setTimeout(poll, intervalMs);
              };
              pollForCompletion();
            } else {
              // No polling available, call onSaved immediately as fallback
              try { onSaved?.(); } catch (e) { console.warn('[ListingForm AutoList] onSaved error:', e); }
            }

          } catch (err) {
            console.error('[ListingForm AutoList] Error:', err);
            const msg = err?.message || String(err);
            if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
              // Clear files to prevent re-triggering the auto-list effect
              if (mountedRef.current) {
                setFiles([]);
              }
              // Use global modal callback if available, otherwise local state
              if (typeof onModerationError === 'function') {
                onModerationError();
              } else if (mountedRef.current) {
                setShowModerationModal(true);
              }
            } else if (mountedRef.current && typeof window !== 'undefined' && !isMobileDevice()) {
              // Only show alert on desktop - can cause crashes on mobile
              alert(`Auto-list failed: ${msg}`);
            }
          } finally {
            autoRunning.current = false;
          }
        }, 0);
      }, [autoListEnabled, autoPostNearbyEnabled, inquiryEnabled, draft, files, onCancel, onSaved, enqueueListingJob]);

      // UPDATED: Submit function that handles image changes properly
      // Update the submit function (remove the duplicate and fix it):
      async function submit(e) {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
          const totalImages = existingUrls.length + files.length;
          if (totalImages === 0) {
            alert('Please add at least one image.');
            return;
          }

          const trimmedLocation = String(location || '').trim();
          if (!trimmedLocation) {
            alert('Location is required.');
            return;
          }

          const parsedPrice = Number(priceVal);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

          const basePayload = {
            title: String(title || '').trim(),
            description: String(description || '').trim(),
            location: trimmedLocation,
            price: markedFree ? 0 : safePrice,
            tags: String(tags || '').trim(),
            enable_nearby: enableNearby ? 1 : 0,
            is_free: markedFree ? 1 : 0,
            custom_tag: isPremium && customTag.trim() ? customTag.trim().slice(0, 12) : null,
            custom_tag_color: isPremium && customTag.trim() ? customTagColor : null
          };

          if (draft || inquiryEnabled) {
            basePayload.inquiry_enabled = markedFree ? 0 : (inquiryEnabled ? 1 : 0);
          }

          if (enableNearby) {
            // For new listings or if user clicked "use my location", use current lat/lon
            // For edits with existing coords (hasFixedGps), send the draft's coords
            if (hasFixedGps) {
              basePayload.lat = draft?.lat;
              basePayload.lon = draft?.lon;
            } else {
              basePayload.lat = lat;
              basePayload.lon = lon;
            }
          }

          if (basePayload.enable_nearby && (basePayload.lat == null || basePayload.lon == null)) {
            // Location fetch still in progress or failed - disable nearby for this listing instead of blocking
            basePayload.enable_nearby = 0;
            basePayload.lat = null;
            basePayload.lon = null;
          }

          if (draft) {
            const payload = { ...basePayload };
            const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
            if (deletedImages.length > 0) {
              payload.deletedImages = deletedImages;
            }

            await api.updateListing(draft.id, payload);
            if (files.length) await uploadFilesForListing(draft.id, files);
            onSaved?.();
            return;
          }

          const filesSnapshot = files.slice();
          const runCreate = async () => {
            const payload = { ...basePayload };
            if (filesSnapshot.length) {
              const uploads = await Promise.all(filesSnapshot.map(uploadFileDraft));
              const tokens = uploads.map((u) => u.uploadToken).filter(Boolean);
              if (!tokens.length) {
                throw new Error('Image upload failed');
              }
              payload.upload_tokens = tokens;
            }

            const created = await api.createListing(payload);
            if (!created?.id) { throw new Error('Create failed'); }
          };

          if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
            // Don't close immediately - wait for result to handle moderation errors
            try {
              await runCreate();
              onSaved?.();
              // Only notify queue for UI feedback (toast), actual creation is done
              try { enqueueListingJob(async () => {}); } catch (e) { /* ignore */ }
            } catch (err) {
              console.error('Create/save failed:', err);
              const msg = err?.message || String(err);
              if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
                if (typeof onModerationError === 'function') {
                  onModerationError();
                } else {
                  setShowModerationModal(true);
                }
              } else {
                alert(`Create/save failed: ${msg}`);
              }
            }
            return;
          }

          await runCreate();
          onSaved?.();
        } catch (err) {
          console.error('Create/save failed:', err);
          const msg = err?.message || String(err);
          if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
            if (typeof onModerationError === 'function') {
              onModerationError();
            } else {
              setShowModerationModal(true);
            }
          } else {
            alert(`Create/save failed: ${msg}`);
          }
        } finally {
          setSaving(false);
        }
      }

      const showInquiryText = !markedFree && !!inquiryEnabled;
      const formattedPrice = markedFree ? price(0) : price(Number(priceVal) || 0);

      // On desktop for new listings, show simplified upload-only view until files are added
      const isDesktopNewListing = !draft && !isMobile;
      const showSimplifiedView = isDesktopNewListing && files.length === 0 && existingUrls.length === 0;

      // Simplified desktop view - just file upload
      if (showSimplifiedView) {
        return H('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            textAlign: 'center',
            minHeight: 300
          }
        },
          H('div', {
            style: {
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20
            }
          },
            H('svg', {
              width: 36,
              height: 36,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: '#fff',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
              H('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
              H('polyline', { points: '21 15 16 10 5 21' })
            )
          ),
          H('h2', {
            style: {
              margin: '0 0 8px',
              fontSize: 24,
              fontWeight: 700,
              color: '#0f172a'
            }
          }, 'New Listing'),
          H('p', {
            style: {
              margin: '0 0 24px',
              fontSize: 15,
              color: '#64748b',
              lineHeight: 1.5,
              maxWidth: 320
            }
          }, 'Select photos and AI will generate your listing. You can edit details after.'),
          H(MultiFilePicker, { files, onChange: setFiles }),
          H('button', {
            type: 'button',
            className: 'btn',
            onClick: onCancel,
            style: { marginTop: 16 }
          }, 'Cancel')
        );
      }

      // Modern form design matching mobile
      return H('form', {
        onSubmit: submit,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 600,
          margin: '0 auto',
          padding: '24px 0',
          position: 'relative'
        }
      },
        // Auto-list overlay while it works
        autoBusy && H('div', {
          style: {
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.9)',
            display: 'grid', placeItems: 'center', zIndex: 5, borderRadius: 16
          }
        }, H('div', { style: { textAlign: 'center' } },
          H('div', { className: 'spinner', style: { marginBottom: 12 } }),
          H('div', { style: { fontWeight: 600, color: '#374151' } }, 'Auto-listing...')
        )),

        // ==================== IMAGES SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Photos'),

          // Existing images with delete capability
          (existingUrls.length > 0) && H('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            H('div', { style: { fontSize: 13, color: '#64748b', fontWeight: 500 } }, 'Current images'),
            H('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
              ...existingUrls.map((src, i) =>
                H('div', {
                  key: i,
                  style: {
                    position: 'relative',
                    width: 100,
                    height: 100,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }
                },
                  H(ImageWithSkeleton, {
                    src,
                    style: { width: '100%', height: '100%', objectFit: 'cover' }
                  }),
                  H('button', {
                    type: 'button',
                    onClick: () => {
                      const next = [...existingUrls];
                      next.splice(i, 1);
                      setExistingUrls(next);
                    },
                    style: {
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: 'rgba(239,68,68,0.9)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }
                  }, '×')
                )
              )
            )
          ),

          // New file picker
          H(MultiFilePicker, { files, onChange: setFiles })
        ),

        // ==================== AI ANALYSIS ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          H('button', {
            type: 'button',
            disabled: aiBusy || aiCooldown > 0,
            onClick: runAI,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 20px',
              background: (aiBusy || aiCooldown > 0) ? '#e2e8f0' : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              color: (aiBusy || aiCooldown > 0) ? '#64748b' : '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: (aiBusy || aiCooldown > 0) ? 'not-allowed' : 'pointer'
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })
            ),
            aiBusy ? 'Analyzing...' : (aiCooldown > 0 ? `Wait ${aiCooldown}s` : 'Auto-fill with AI')
          ),
          aiErr && H('p', { style: { margin: 0, color: '#dc2626', fontSize: 13 } }, aiErr)
        ),

        // ==================== DETAILS SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Details'),

          // Title
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Title'),
            H('input', {
              value: title,
              maxLength: 80,
              onChange: e => setTitle(e.target.value),
              placeholder: 'What are you selling?',
              style: INPUT_STYLE
            })
          ),

          // Description
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Description'),
            H('textarea', {
              value: description,
              maxLength: 400,
              rows: 4,
              onChange: e => setDescription(e.target.value),
              placeholder: 'Describe your item, condition, features...',
              style: { ...INPUT_STYLE, lineHeight: '1.5', resize: 'none' }
            })
          ),

          // Price
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, opacity: markedFree ? 0.5 : 1, transition: 'opacity 0.2s ease' } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Price'),
            H('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              H('div', { style: { position: 'relative', flex: 1 } },
                H('span', { style: { position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 16, fontWeight: 500 } }, '$'),
                H('input', {
                  value: markedFree ? '' : priceVal,
                  inputMode: 'decimal',
                  disabled: markedFree,
                  onChange: e => setPriceVal(e.target.value.replace(/[^0-9.]/g, '')),
                  placeholder: markedFree ? 'Free' : '0.00',
                  style: { ...INPUT_STYLE, paddingLeft: 28, cursor: markedFree ? 'not-allowed' : 'text' }
                })
              ),
              markedFree ? H('span', {
                style: {
                  fontSize: 12,
                  padding: '6px 10px',
                  background: '#fdf2f8',
                  color: '#be185d',
                  borderRadius: 6,
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }
              }, 'Free') : (showInquiryText && H('span', {
                style: {
                  fontSize: 12,
                  padding: '6px 10px',
                  background: '#fef3c7',
                  color: '#92400e',
                  borderRadius: 6,
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }
              }, 'Wants offers'))
            )
          ),

          // Inquiry toggle
          H('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: (!markedFree && inquiryEnabled) ? '#fef3c7' : '#f8fafc',
              borderRadius: 10,
              cursor: markedFree ? 'not-allowed' : 'pointer',
              opacity: markedFree ? 0.5 : 1,
              border: (!markedFree && inquiryEnabled) ? '1px solid #fcd34d' : '1px solid transparent',
              transition: 'all 0.2s ease'
            }
          },
            H('input', {
              type: 'checkbox',
              checked: markedFree ? false : inquiryEnabled,
              disabled: markedFree,
              onChange: e => setInquiryEnabled(e.target.checked),
              style: { width: 20, height: 20, accentColor: '#d97706' }
            }),
            H('div', { style: { flex: 1 } },
              H('div', { style: { fontSize: 14, fontWeight: 600, color: (!markedFree && inquiryEnabled) ? '#92400e' : '#0f172a' } }, 'Display offer banner'),
              H('div', { style: { fontSize: 12, color: '#64748b' } }, markedFree ? 'Not available for free items' : 'Buyers will be more likely to make an offer')
            ),
            H('button', {
              type: 'button',
              onClick: (e) => { e.preventDefault(); e.stopPropagation(); setShowInquiryHelp(true); },
              style: {
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '1px solid #e5e7eb',
                background: '#fff',
                fontSize: 13,
                fontWeight: 600,
                color: '#64748b',
                cursor: 'pointer'
              }
            }, '?')
          ),

          // Mark as Free toggle
          H('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: markedFree ? '#fdf2f8' : '#f8fafc',
              borderRadius: 10,
              cursor: 'pointer',
              border: markedFree ? '1px solid #f9a8d4' : '1px solid transparent',
              transition: 'all 0.2s ease'
            }
          },
            H('input', {
              type: 'checkbox',
              checked: markedFree,
              onChange: e => {
                const checked = e.target.checked;
                setMarkedFree(checked);
                if (checked) {
                  setPriceVal('');
                  setInquiryEnabled(false);
                }
              },
              style: { width: 20, height: 20, accentColor: '#ec4899' }
            }),
            H('div', { style: { flex: 1 } },
              H('div', { style: { fontSize: 14, fontWeight: 600, color: markedFree ? '#be185d' : '#0f172a' } }, 'Mark as Free'),
              H('div', { style: { fontSize: 12, color: '#64748b' } }, 'Give this item away for free')
            )
          ),

          // Show in Nearest searches toggle
          H('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: enableNearby ? '#ecfdf5' : '#f8fafc',
              borderRadius: 10,
              cursor: 'pointer',
              border: enableNearby ? '1px solid #6ee7b7' : '1px solid transparent',
              transition: 'all 0.2s ease'
            }
          },
            H('input', {
              type: 'checkbox',
              checked: enableNearby,
              onChange: e => {
                const checked = e.target.checked;
                setEnableNearby(checked);
                if (checked && !hasFixedGps) useMyLocation();
              },
              style: { width: 20, height: 20, accentColor: '#059669' }
            }),
            H('div', { style: { flex: 1 } },
              H('div', { style: { fontSize: 14, fontWeight: 600, color: enableNearby ? '#059669' : '#0f172a' } }, 'Show in Nearest searches'),
              H('div', { style: { fontSize: 12, color: '#64748b' } }, 'Buyers can see the item\'s distance from them')
            )
          ),

          // Custom Tag input - Premium feature
          H('div', {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '12px 14px',
              background: customTag.trim() ? '#f0f9ff' : '#f8fafc',
              borderRadius: 10,
              border: customTag.trim() ? '1px solid #7dd3fc' : '1px solid transparent',
              opacity: isPremium ? 1 : 0.7,
              transition: 'all 0.2s ease'
            }
          },
            H('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              H('label', { style: { fontSize: 14, fontWeight: 600, color: customTag.trim() ? '#0284c7' : '#374151' } }, 'Custom Tag'),
              !isPremium && H('button', {
                type: 'button',
                onClick: (e) => { e.preventDefault(); onOpenPremiumModal?.(); },
                style: {
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer'
                }
              }, 'PREMIUM')
            ),
            H('input', {
              value: customTag,
              maxLength: 12,
              disabled: !isPremium,
              onChange: e => setCustomTag(e.target.value),
              placeholder: isPremium ? 'e.g. Vintage, New, Sale' : 'Premium feature',
              style: {
                ...INPUT_STYLE,
                cursor: isPremium ? 'text' : 'not-allowed',
                background: isPremium ? '#fff' : '#f1f5f9'
              }
            }),
            // Color palette for custom tag
            H('div', {
              style: {
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                padding: '8px 0'
              }
            },
              TAG_COLORS.map(({ hex, name }) =>
                H('div', {
                  key: hex,
                  title: name,
                  role: 'button',
                  tabIndex: isPremium ? 0 : -1,
                  onClick: isPremium ? () => setCustomTagColor(hex) : undefined,
                  style: {
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: hex,
                    border: customTagColor === hex ? '3px solid #fff' : '2px solid rgba(255,255,255,0.3)',
                    cursor: isPremium ? 'pointer' : 'not-allowed',
                    opacity: isPremium ? 1 : 0.4,
                    boxShadow: customTagColor === hex ? '0 0 8px rgba(255,255,255,0.5)' : '0 1px 3px rgba(0,0,0,0.3)',
                    transition: 'all 0.15s ease',
                    flexShrink: 0
                  }
                })
              )
            ),
            H('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' } },
              H('span', null, 'Displays as a badge on your listing'),
              H('span', null, `${customTag.length}/12`)
            )
          )
        ),

        // ==================== LOCATION SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Location'),

          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'City or area'),
            H('input', {
              value: location,
              maxLength: 80,
              onChange: e => setLocation(e.target.value),
              placeholder: 'e.g. Brooklyn, NY',
              style: INPUT_STYLE
            })
          ),

          H('button', {
            type: 'button',
            onClick: useMyLocation,
            disabled: geoBusy,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              background: '#fff',
              color: '#374151',
              fontSize: 14,
              fontWeight: 500,
              cursor: geoBusy ? 'not-allowed' : 'pointer'
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('circle', { cx: 12, cy: 12, r: 10 }),
              H('circle', { cx: 12, cy: 12, r: 3 }),
              H('line', { x1: 12, y1: 2, x2: 12, y2: 4 }),
              H('line', { x1: 12, y1: 20, x2: 12, y2: 22 }),
              H('line', { x1: 2, y1: 12, x2: 4, y2: 12 }),
              H('line', { x1: 20, y1: 12, x2: 22, y2: 12 })
            ),
            geoBusy ? 'Getting location...' : 'Use my current location'
          ),

          geoErr && H('p', { style: { margin: 0, color: '#dc2626', fontSize: 13 } }, geoErr),
          (enableNearby && hasFixedGps) && H('p', { style: { margin: 0, color: '#64748b', fontSize: 12 } }, 'GPS coordinates fixed at creation and cannot be changed.')
        ),

        // ==================== SEARCH TAGS SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          H('div', null,
            H('h2', { style: { fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' } }, 'Search Tags'),
            H('p', { style: { margin: 0, fontSize: 13, color: '#64748b' } }, 'Private tags to help buyers find your item')
          ),
          H('input', {
            value: tags,
            onChange: e => setTags(e.target.value),
            placeholder: 'e.g. vintage, electronics, collectible',
            style: INPUT_STYLE
          })
        ),

        // ==================== FOOTER BUTTONS ====================
        H('div', {
          style: {
            display: 'flex',
            gap: 12,
            padding: '16px 0',
            borderTop: '1px solid #e5e7eb',
            marginTop: 8
          }
        },
          H('button', {
            type: 'submit',
            disabled: autoBusy || saving,
            style: {
              flex: 1,
              padding: '14px 24px',
              background: saving
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : (autoBusy ? '#94a3b8' : '#2563eb'),
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: (autoBusy || saving) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'background 0.2s ease'
            }
          },
            saving && H('span', {
              style: {
                width: 16,
                height: 16,
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite'
              }
            }),
            saving ? 'Saving...' : (draft ? 'Save Changes' : 'Create Listing')
          ),
          H('button', {
            type: 'button',
            onClick: onCancel,
            disabled: autoBusy || saving,
            style: {
              padding: '14px 24px',
              background: '#f1f5f9',
              color: '#374151',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: (autoBusy || saving) ? 'not-allowed' : 'pointer'
            }
          }, 'Cancel')
        ),

        showInquiryHelp && H(InquiryHelpModal, { onClose: () => setShowInquiryHelp(false) }),

        // Moderation flagged modal
        showModerationModal && H('div', {
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999
          },
          onClick: () => setShowModerationModal(false)
        },
          H('div', {
            onClick: e => e.stopPropagation(),
            style: {
              padding: 32,
              maxWidth: 400,
              textAlign: 'center',
              background: '#fff',
              borderRadius: 20,
              boxShadow: '0 25px 50px rgba(0,0,0,0.25)'
            }
          },
            H('div', { style: { fontSize: 48, marginBottom: 16 } }, '\u26A0\uFE0F'),
            H('h3', { style: { margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#0f172a' } }, 'Submission Under Review'),
            H('p', { style: { margin: '0 0 20px', color: '#64748b', lineHeight: 1.5 } },
              'Your submission has been flagged for review by our administrators. This is a routine check to ensure content meets our community guidelines.'
            ),
            H('button', {
              onClick: () => setShowModerationModal(false),
              style: {
                width: '100%',
                padding: '14px 24px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer'
              }
            }, 'OK')
          )
        )
      );
    }

    // --- MassList Modal (fixed) ---
    function MassListModal({ onClose, onDone, reloadMine, addListing, user, autoPostNearbyEnabled, autoInquiryEnabled, onLockedAction, onAuthClick, backgroundQueueEnabled, enqueueListingJob, initialFiles = [], onModerationError }) {
      const [files, setFiles] = useState(() => Array.isArray(initialFiles) ? initialFiles.slice() : []);
      const [busy, setBusy] = useState(false);
      const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
      const [showModerationModal, setShowModerationModal] = useState(false);
      const filePreviews = useFilePreviews(files);

      const cameraRef = useRef();
      const galleryRef = useRef();

      useEffect(() => {
        if (!Array.isArray(initialFiles)) return;
        if (initialFiles.length === 0) {
          setFiles([]);
          if (cameraRef.current) cameraRef.current.value = '';
          if (galleryRef.current) galleryRef.current.value = '';
          return;
        }
        setFiles(initialFiles.slice());
        if (cameraRef.current) cameraRef.current.value = '';
        if (galleryRef.current) galleryRef.current.value = '';
      }, [initialFiles]);

      function pick(e) {
        const selected = Array.from(e.target.files || []);
        addFiles(selected);
        if (e.target) e.target.value = '';
      }

      function addFiles(selected) {
        const MAX_EACH_MB = 20;
        const next = [...files];
        for (const f of selected) {
          if (!f.type?.startsWith?.('image/')) { alert('Only images are allowed'); continue; }
          if (f.size > MAX_EACH_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_EACH_MB}MB`); continue; }
          next.push(f);
        }
        setFiles(next);
      }

      async function pickFromGallery() {
        // On Capacitor, use native gallery picker (no extra prompt)
        const nativeFiles = await pickGalleryImages(12);
        if (nativeFiles !== null) {
          // null means unavailable, [] means cancelled, [...] means files
          if (nativeFiles.length > 0) {
            addFiles(nativeFiles);
          }
          return;
        }
        // Fallback to HTML input for web
        galleryRef.current?.click();
      }

      function removeAt(i) {
        const next = [...files];
        const [removed] = next.splice(i, 1);
        if (removed) clearDraftCacheForFile(removed);
        setFiles(next);
      }

      const executeMassList = async ({ filesSnapshot, trackProgress }) => {
        const total = filesSnapshot.length;
        let failedCount = 0;
        let doneCount = 0;
        let moderationFlagged = false;

        const updateProgress = trackProgress
          ? (nextDone, nextFailed) => setProgress({ done: nextDone, total, failed: nextFailed })
          : () => { };

        updateProgress(0, 0);

        // MassList has no manual location field, so always attempt to fetch
        // coordinates regardless of the autoPostNearbyEnabled setting.
        let sharedNearby = { ok: false, lat: null, lon: null, display: '' };
        try {
          const c = await fetchCoordsAndReverseInternal();
          sharedNearby = { ok: true, lat: c.lat, lon: c.lon, display: c.display };
        } catch (_) {
          sharedNearby = { ok: false, lat: null, lon: null, display: '' };
        }

        const nearbyLocation = sharedNearby.display ? String(sharedNearby.display).trim() : '';
        const presetLocation = typeof user?.location_preset === 'string'
          ? user.location_preset.trim()
          : '';
        // When geolocation fails or is unavailable, fall back to the saved
        // profile preset, then to the generic placeholder.
        const normalizedLocation = nearbyLocation || presetLocation || 'Unknown location';

        const limiter = createConcurrencyLimiter(3);

        const jobs = filesSnapshot.map((file) => limiter(async () => {
          let encounteredError = false;
          try {
            const upload = await uploadFileDraft(file);

            // Use fire-and-forget API so AI analysis runs server-side
            // even if the app is closed
            if (typeof api.createAutoListing === 'function') {
              const payload = {
                upload_tokens: [upload.uploadToken],
                location: normalizedLocation,
                hint: '',
                ai_enabled: true,
                enable_nearby: autoPostNearbyEnabled && sharedNearby.ok,
                inquiry_enabled: autoInquiryEnabled
              };
              if (autoPostNearbyEnabled && sharedNearby.ok) {
                payload.lat = sharedNearby.lat;
                payload.lon = sharedNearby.lon;
              }

              const result = await api.createAutoListing(payload, { silent: true });
              if (!result?.job_id) throw new Error('create_failed');

              // Poll for job completion to get the created listing
              if (typeof api.getAutoListingStatus === 'function' && typeof addListing === 'function') {
                const pollJob = async () => {
                  const maxAttempts = 30;
                  const intervalMs = 2000;
                  for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    try {
                      const status = await api.getAutoListingStatus(result.job_id, { silent: true });
                      if (status?.status === 'completed' && status.listing) {
                        addListing(status.listing);
                        return;
                      }
                      if (status?.status === 'failed') {
                        return;
                      }
                    } catch (e) { /* ignore poll errors */ }
                    await new Promise(r => setTimeout(r, intervalMs));
                  }
                };
                pollJob().catch(() => {});
              }
            } else {
              // Fallback to legacy client-side flow if API not available
              let ai = {};
              try {
                ai = await api.aiAnalyze({ images: [upload.publicUrl], hint: '' }, { silent: true }) || {};
              } catch (_) {
                /* ignore AI failure; fallback below */
              }

              const safePrice = (Number.isFinite(ai.suggested_price) && ai.suggested_price >= 0) ? ai.suggested_price : 0;
              const payload = {
                title: (ai.title || 'Item for sale').toString().slice(0, 80),
                description: '',
                location: normalizedLocation,
                price: safePrice,
                tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
                enable_nearby: (autoPostNearbyEnabled && sharedNearby.ok) ? 1 : 0,
                upload_tokens: [upload.uploadToken]
              };
              if (autoInquiryEnabled) payload.inquiry_enabled = 1;
              if (autoPostNearbyEnabled && sharedNearby.ok) { payload.lat = sharedNearby.lat; payload.lon = sharedNearby.lon; }

              const created = await api.createListing(payload, { silent: true });
              if (!created?.id) throw new Error('create_failed');
              // Immediately add to home page
              if (typeof addListing === 'function') {
                addListing(created);
              }
              if (autoInquiryEnabled && created?.id) {
                try {
                  await api.updateListing(created.id, { inquiry_enabled: 1 }, { silent: true });
                } catch (err) {
                  console.error('Failed to mark mass-listed item as inquiry-enabled:', err);
                }
              }
            }

          } catch (err) {
            encounteredError = true;
            failedCount += 1;
            console.error('MassList failed:', err);
            const msg = err?.message || String(err);
            if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
              moderationFlagged = true;
            }
          } finally {
            doneCount += 1;
            updateProgress(doneCount, failedCount);
          }

          return !encounteredError;
        }));

        await Promise.allSettled(jobs);

        // Note: addListing is called for each created listing above,
        // so we don't need reloadAll which would replace the listings array
        try { await reloadMine(); } catch { }

        return { total, created: total - failedCount, failed: failedCount, moderationFlagged };
      };

      async function runMassList() {
        if (!user) { onAuthClick?.('login'); return; }
        if (user.account_status === 'locked') { onLockedAction?.(); return; }
        if (!files.length) { alert('Pick at least one image.'); return; }

        const filesSnapshot = files.slice();

        const runJob = async (trackProgress) => {
          const stats = await executeMassList({ filesSnapshot, trackProgress });
          // Check if any files were flagged by moderation
          if (stats.moderationFlagged) {
            setFiles([]); // Clear files to prevent re-trigger
            if (typeof onModerationError === 'function') {
              onModerationError();
            } else {
              setShowModerationModal(true);
            }
            return { shouldClose: false };
          }
          onDone && onDone(stats);
          return { shouldClose: true };
        };

        if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
          // Don't close immediately - wait for job to complete to catch moderation errors
          setBusy(true);
          setProgress({ done: 0, total: filesSnapshot.length, failed: 0 });
          try {
            const result = await runJob(true);
            if (result?.shouldClose) onClose?.();
          } catch (err) {
            console.error('MassList failed:', err);
            const msg = err?.message || String(err);
            if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
              setFiles([]); // Clear files to prevent re-trigger
              if (typeof onModerationError === 'function') {
                onModerationError();
              } else {
                setShowModerationModal(true);
              }
            } else {
              alert(`MassList failed: ${msg}`);
            }
          } finally {
            setBusy(false);
          }
          return;
        }

        setBusy(true);
        setProgress({ done: 0, total: filesSnapshot.length, failed: 0 });
        try {
          const result = await runJob(true);
          if (result?.shouldClose) onClose?.();
        } catch (err) {
          console.error('MassList failed:', err);
          const msg = err?.message || String(err);
          if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
            setFiles([]); // Clear files to prevent re-trigger
            if (typeof onModerationError === 'function') {
              onModerationError();
            } else {
              setShowModerationModal(true);
            }
          } else {
            alert(`MassList failed: ${msg}`);
          }
        } finally {
          setBusy(false);
        }
      }

      // Camera icon SVG
      const CameraIcon = H('svg', { viewBox: '0 0 24 24', width: 32, height: 32, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        H('rect', { x: 3, y: 6, width: 18, height: 13, rx: 3 }),
        H('path', { d: 'M9 6l1.5-2h3L15 6' }),
        H('circle', { cx: 12, cy: 12.5, r: 3 })
      );

      // Gallery icon SVG
      const GalleryIcon = H('svg', { viewBox: '0 0 24 24', width: 32, height: 32, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        H('circle', { cx: 9, cy: 10, r: 2, fill: 'currentColor', stroke: 'none' }),
        H('path', { d: 'M7 18l4-4 3 3 4-5 3 4' })
      );

      const modal = H('div', { className: 'modal open', onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); } },
        H('div', { className: 'modal-inner masslist-modal', style: { width: 'min(680px, 92vw)', borderRadius: 24, overflow: 'hidden' } },
          H('button', { className: 'close', onClick: onClose }, 'x'),
          H('div', { style: { padding: 16 } },
            H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'MassList'),
            H('div', { className: 'muted', style: { marginBottom: 16 } }, 'Take photos or select from gallery. One listing will be created per photo using AI.'),

            // Hidden file inputs
            H('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, ref: cameraRef, onChange: pick, style: { display: 'none' } }),
            H('input', { type: 'file', accept: 'image/*', multiple: true, ref: galleryRef, onChange: pick, style: { display: 'none' } }),

            // Camera and Gallery buttons
            H('div', { style: { display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 16 } },
              H('button', {
                type: 'button',
                onClick: () => cameraRef.current?.click(),
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '20px 32px',
                  borderRadius: 16,
                  border: '2px solid #e5e7eb',
                  background: '#f9fafb',
                  cursor: 'pointer',
                  color: '#374151',
                  transition: 'all 0.15s ease'
                },
                onMouseOver: (e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; },
                onMouseOut: (e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }
              },
                CameraIcon,
                H('span', { style: { fontSize: 14, fontWeight: 600 } }, 'Camera')
              ),
              H('button', {
                type: 'button',
                onClick: pickFromGallery,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '20px 32px',
                  borderRadius: 16,
                  border: '2px solid #e5e7eb',
                  background: '#f9fafb',
                  cursor: 'pointer',
                  color: '#374151',
                  transition: 'all 0.15s ease'
                },
                onMouseOver: (e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; },
                onMouseOut: (e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }
              },
                GalleryIcon,
                H('span', { style: { fontSize: 14, fontWeight: 600 } }, 'Gallery')
              )
            ),

            // Selected count
            files.length > 0 && H('div', { style: { textAlign: 'center', marginBottom: 12, color: '#6b7280', fontSize: 14 } }, `${files.length} photo${files.length === 1 ? '' : 's'} selected`),

            filePreviews.length > 0 && H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap', marginTop: 12, justifyContent: 'center' } },
              ...filePreviews.map(({ url }, i) =>
                H('div', { key: i, style: { position: 'relative' } },
                  H(ImageWithSkeleton, { src: url, style: { width: 80, height: 80, objectFit: 'cover', borderRadius: 12, border: '1px solid #e5e7eb' }, loading: 'lazy', decoding: 'async' }),
                  H('button', { className: 'btn danger', type: 'button', style: { position: 'absolute', top: 2, right: 2, padding: '2px 6px', fontSize: 12 }, onClick: () => removeAt(i) }, '×')
                )
              )
            ),

            H('div', { className: 'row', style: { marginTop: 16, justifyContent: 'center', gap: 12 } },
              H('button', { className: 'btn', onClick: onClose, disabled: busy }, 'Cancel'),
              H('button', { className: `btn primary`, onClick: runMassList, disabled: busy || files.length === 0 }, busy ? 'Working...' : 'Create Listings')
            )
          ),

          // Progress overlay
          busy && H('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
              display: 'grid', placeItems: 'center', zIndex: 10, textAlign: 'center', padding: '16px'
            }
          },
            H('div', null,
              H('div', { className: 'spinner' }),
              H('div', { style: { fontWeight: 800, marginTop: 6 } }, 'MassList in progress...'),
              H('div', { className: 'muted', style: { marginTop: 4 } }, `${progress.done}/${progress.total} completed`),
              progress.failed > 0 && H('div', { className: 'muted', style: { marginTop: 2, color: '#b91c1c' } }, `${progress.failed} failed`)
            )
          )
        )
      );

      // Moderation flagged modal
      const moderationModal = showModerationModal && H('div', {
        className: 'modal-overlay',
        onClick: () => setShowModerationModal(false),
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999 }
      },
        H('div', {
          onClick: e => e.stopPropagation(),
          style: { padding: 24, maxWidth: 400, textAlign: 'center', background: '#fff', borderRadius: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }
        },
          H('div', { style: { fontSize: 48, marginBottom: 12 } }, '\u26A0\uFE0F'),
          H('h3', { style: { marginBottom: 12 } }, 'Submission Under Review'),
          H('p', { style: { marginBottom: 16, color: '#666' } },
            'Your submission has been flagged for review by our administrators. This is a routine check to ensure content meets our community guidelines. We will review it shortly.'
          ),
          H('button', {
            className: 'btn primary',
            onClick: () => setShowModerationModal(false),
            style: { width: '100%' }
          }, 'OK')
        )
      );

      return ReactDOM.createPortal(
        H(React.Fragment, null, modal, moderationModal),
        document.body
      );
    }

    const REPORT_REASON_OPTIONS = [
      { value: 'fraud', label: 'Fraud or scam' },
      { value: 'spam', label: 'Spam or advertising' },
      { value: 'inappropriate', label: 'Inappropriate content' },
      { value: 'harassment', label: 'Harassment or abusive behavior' },
      { value: 'other', label: 'Other' }
    ];

    function makeReportCaptcha() {
      return {
        a: 2 + Math.floor(Math.random() * 7),
        b: 2 + Math.floor(Math.random() * 7)
      };
    }

    const RECAPTCHA_SITE_KEY = '6LfdgSAsAAAAALd3zwHaKy5uGeFQivCfgBpFx2DL';

    function ReportSellerModal({ open, listing, onClose, onReported }) {
      const [selected, setSelected] = useState(() => new Set());
      const [details, setDetails] = useState('');
      const [recaptchaToken, setRecaptchaToken] = useState('');
      const [error, setError] = useState('');
      const [submitting, setSubmitting] = useState(false);
      const [submitted, setSubmitted] = useState(false);
      const recaptchaRef = useRef(null);
      const recaptchaWidgetId = useRef(null);

      useEffect(() => {
        if (!open) return;
        setSelected(new Set());
        setDetails('');
        setRecaptchaToken('');
        setError('');
        setSubmitted(false);
        // Reset reCAPTCHA widget if it exists
        if (recaptchaWidgetId.current !== null && window.grecaptcha) {
          try { window.grecaptcha.reset(recaptchaWidgetId.current); } catch (e) {}
        }
      }, [open, listing?.id]);

      // Render reCAPTCHA when modal opens
      useEffect(() => {
        if (!open || submitted) return;
        const renderRecaptcha = () => {
          if (recaptchaRef.current && window.grecaptcha && window.grecaptcha.render) {
            // Clear any existing widget
            recaptchaRef.current.innerHTML = '';
            recaptchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
              sitekey: RECAPTCHA_SITE_KEY,
              callback: (token) => setRecaptchaToken(token),
              'expired-callback': () => setRecaptchaToken('')
            });
          }
        };
        // Wait for grecaptcha to be ready
        if (window.grecaptcha && window.grecaptcha.render) {
          setTimeout(renderRecaptcha, 100);
        } else {
          const interval = setInterval(() => {
            if (window.grecaptcha && window.grecaptcha.render) {
              clearInterval(interval);
              renderRecaptcha();
            }
          }, 100);
          return () => clearInterval(interval);
        }
      }, [open, submitted]);

      useEffect(() => {
        if (!open) return;
        const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);

      const toggleReason = (value) => {
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
      };

      const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting || submitted) return;
        setError('');
        const reasons = Array.from(selected);
        if (!reasons.length) {
          setError('Select at least one reason.');
          return;
        }
        if (reasons.includes('other') && !details.trim()) {
          setError('Please include details for "Other".');
          return;
        }
        if (!recaptchaToken) {
          setError('Please complete the reCAPTCHA verification.');
          return;
        }
        setSubmitting(true);
        try {
          await api.reportSeller({
            reported_user_id: listing?.user_id,
            listing_id: listing?.id,
            reasons,
            details: details.trim() || undefined,
            recaptchaToken
          });
          setSubmitted(true);
          onReported?.();
        } catch (err) {
          setError(err.message || 'Unable to submit report.');
          // Reset reCAPTCHA on error
          setRecaptchaToken('');
          if (recaptchaWidgetId.current !== null && window.grecaptcha) {
            try { window.grecaptcha.reset(recaptchaWidgetId.current); } catch (e) {}
          }
        } finally {
          setSubmitting(false);
        }
      };

      if (!open) return null;

      const sellerName = listing?.owner_username ? listing.owner_username : 'this seller';

      const modal = H('div', {
        className: 'modal-overlay',
        onClick: (e) => { if (e.target.classList.contains('modal-overlay')) onClose?.(); }
      },
        H('div', { className: 'modal-content', style: { maxWidth: '520px' } },
          H('div', { className: 'modal-header' },
            H('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 } }, `Report ${sellerName}`),
            H('button', { className: 'modal-close', onClick: onClose, disabled: submitting && !submitted }, '×')
          ),
          H('div', { className: 'modal-body' },
            submitted ?
              H('div', null,
                H('div', { style: { marginBottom: '20px', color: '#6b7280' } }, 'Thank you. We will review this report shortly.'),
                H('button', { className: 'btn primary', onClick: onClose, style: { width: '100%' } }, 'Close')
              ) :
              H('form', { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
                H('div', null,
                  H('div', { style: { fontWeight: 600, marginBottom: '12px' } }, 'Why are you reporting this seller?'),
                  H('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                    ...REPORT_REASON_OPTIONS.map(opt => H('label', {
                      key: opt.value,
                      style: { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14px', cursor: 'pointer' }
                    },
                      H('input', {
                        type: 'checkbox',
                        checked: selected.has(opt.value),
                        disabled: submitting,
                        onChange: () => toggleReason(opt.value),
                        style: { cursor: 'pointer', marginTop: '2px', flexShrink: 0, width: '18px', height: '18px' }
                      }),
                      H('span', { style: { flex: 1, lineHeight: '1.4' } }, opt.label)
                    ))
                  )
                ),
                H('div', null,
                  H('textarea', {
                    placeholder: 'Additional details (optional)',
                    value: details,
                    onChange: (e) => setDetails(e.target.value),
                    disabled: submitting,
                    rows: 3,
                    style: {
                      width: '100%',
                      fontSize: '14px',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }
                  })
                ),
                H('div', null,
                  H('div', { style: { fontWeight: 600, marginBottom: '8px' } }, 'Verify you\'re human'),
                  H('div', {
                    ref: recaptchaRef,
                    style: { minHeight: '78px' }
                  })
                ),
                error && H('div', { style: { color: '#dc2626', fontSize: '14px', padding: '8px 12px', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' } }, error),
                H('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                  H('button', {
                    className: 'btn primary',
                    type: 'submit',
                    disabled: submitting,
                    style: { flex: 1 }
                  }, submitting ? 'Submitting...' : 'Submit Report'),
                  H('button', {
                    className: 'btn',
                    type: 'button',
                    onClick: onClose,
                    disabled: submitting,
                    style: { flex: 1 }
                  }, 'Cancel')
                )
              )
          )
        )
      );

      return ReactDOM.createPortal(modal, document.body);
    }

    function ListingModal({ open, item, onClose, cardProps = {} }) {
      useBodyScrollLock(open);

      React.useEffect(() => {
        if (!open) return;
        const handler = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            onClose?.();
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [open, onClose]);

      if (!open || !item) return null;

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: (evt) => {
            if (evt.target === evt.currentTarget || evt.target.classList.contains('modal')) {
              onClose?.();
            }
          }
        },
          H('div', {
            className: 'modal-inner listing-modal',
            onClick: (evt) => evt.stopPropagation()
          },
            H('button', { className: 'close', onClick: onClose }, 'x'),
            H(ListingCard, { item, viewContext: 'modal', ...cardProps })
          )
        ),
        document.body
      );
    }

    // ============================================================
    // PinchZoomImage - Pinch-to-zoom image component for lightbox
    // Uses native resolution when zoomed for sharp detail viewing
    // ============================================================
    function PinchZoomImage({ src, alt, onLoad, onError, style, className }) {
      const containerRef = useRef(null);
      const imgRef = useRef(null);
      const [imgLoaded, setImgLoaded] = useState(false);
      const [isZoomed, setIsZoomed] = useState(false);
      const [currentScale, setCurrentScale] = useState(1);
      const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

      const stateRef = useRef({
        scale: 1,
        translateX: 0,
        translateY: 0,
        initialDistance: 0,
        initialScale: 1,
        initialTranslateX: 0,
        initialTranslateY: 0,
        isPinching: false,
        lastTouchX: 0,
        lastTouchY: 0,
        isDragging: false,
        isMouseDragging: false,
        lastMouseX: 0,
        lastMouseY: 0
      });

      const MIN_SCALE = 1;
      const MAX_SCALE = 4;

      const updateTransform = useCallback(() => {
        const img = imgRef.current;
        if (!img) return;
        const { scale, translateX, translateY } = stateRef.current;
        img.style.transform = `translate(${translateX}px, ${translateY}px)`;
        // Update zoom state for rendering at native resolution
        setIsZoomed(scale > 1);
        setCurrentScale(scale);
      }, []);

      const clampTranslation = useCallback(() => {
        const container = containerRef.current;
        const img = imgRef.current;
        if (!container || !img) return;

        const state = stateRef.current;
        const containerRect = container.getBoundingClientRect();

        // Use natural dimensions scaled by zoom level for accurate bounds
        const nw = naturalSize.width || img.naturalWidth || img.offsetWidth;
        const nh = naturalSize.height || img.naturalHeight || img.offsetHeight;

        // Calculate how big the image would be to fit the container at scale 1
        const containerAspect = containerRect.width / containerRect.height;
        const imgAspect = nw / nh;
        let baseWidth, baseHeight;
        if (imgAspect > containerAspect) {
          baseWidth = containerRect.width;
          baseHeight = containerRect.width / imgAspect;
        } else {
          baseHeight = containerRect.height;
          baseWidth = containerRect.height * imgAspect;
        }

        // At scale > 1, we render larger, up to native resolution
        const scaledWidth = Math.min(nw, baseWidth * state.scale);
        const scaledHeight = Math.min(nh, baseHeight * state.scale);

        // Calculate max translation bounds
        const maxTranslateX = Math.max(0, (scaledWidth - containerRect.width) / 2);
        const maxTranslateY = Math.max(0, (scaledHeight - containerRect.height) / 2);

        // Clamp translation
        state.translateX = Math.max(-maxTranslateX, Math.min(maxTranslateX, state.translateX));
        state.translateY = Math.max(-maxTranslateY, Math.min(maxTranslateY, state.translateY));
      }, [naturalSize]);

      const getDistance = useCallback((touches) => {
        if (touches.length < 2) return 0;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }, []);

      const getMidpoint = useCallback((touches) => {
        if (touches.length < 2) return { x: touches[0]?.clientX || 0, y: touches[0]?.clientY || 0 };
        return {
          x: (touches[0].clientX + touches[1].clientX) / 2,
          y: (touches[0].clientY + touches[1].clientY) / 2
        };
      }, []);

      const handleTouchStart = useCallback((e) => {
        const state = stateRef.current;
        const touches = e.touches;

        if (touches.length === 2) {
          e.preventDefault();
          e.stopPropagation();
          state.isPinching = true;
          state.isDragging = false;
          state.initialDistance = getDistance(touches);
          state.initialScale = state.scale;
          state.initialTranslateX = state.translateX;
          state.initialTranslateY = state.translateY;
        } else if (touches.length === 1 && state.scale > 1) {
          e.stopPropagation();
          state.isDragging = true;
          state.isPinching = false;
          state.lastTouchX = touches[0].clientX;
          state.lastTouchY = touches[0].clientY;
        }
      }, [getDistance]);

      const handleTouchMove = useCallback((e) => {
        const state = stateRef.current;
        const touches = e.touches;

        if (state.isPinching && touches.length === 2) {
          e.preventDefault();
          e.stopPropagation();
          const currentDistance = getDistance(touches);
          const scaleFactor = currentDistance / state.initialDistance;
          let newScale = state.initialScale * scaleFactor;
          newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
          state.scale = newScale;

          // Reset translation if zooming back to 1
          if (newScale <= 1) {
            state.translateX = 0;
            state.translateY = 0;
          }

          clampTranslation();
          updateTransform();
        } else if (state.isDragging && touches.length === 1 && state.scale > 1) {
          e.preventDefault();
          e.stopPropagation();
          const deltaX = touches[0].clientX - state.lastTouchX;
          const deltaY = touches[0].clientY - state.lastTouchY;
          state.translateX += deltaX;
          state.translateY += deltaY;
          state.lastTouchX = touches[0].clientX;
          state.lastTouchY = touches[0].clientY;

          clampTranslation();
          updateTransform();
        }
      }, [getDistance, clampTranslation, updateTransform]);

      const handleTouchEnd = useCallback((e) => {
        const state = stateRef.current;
        const touches = e.touches;

        if (touches.length < 2) {
          state.isPinching = false;
        }
        if (touches.length === 0) {
          state.isDragging = false;
        }

        // Snap back to scale 1 if close
        if (state.scale < 1.1 && !state.isPinching) {
          state.scale = 1;
          state.translateX = 0;
          state.translateY = 0;
          updateTransform();
        }
      }, [updateTransform]);

      // Reset zoom when image changes
      useEffect(() => {
        const state = stateRef.current;
        state.scale = 1;
        state.translateX = 0;
        state.translateY = 0;
        state.isPinching = false;
        state.isDragging = false;
        setImgLoaded(false);
        setIsZoomed(false);
        setCurrentScale(1);
        setNaturalSize({ width: 0, height: 0 });
        if (imgRef.current) {
          imgRef.current.style.transform = '';
        }
      }, [src]);

      // Double-tap to zoom
      const lastTapRef = useRef(0);
      const handleTap = useCallback((e) => {
        const now = Date.now();
        const state = stateRef.current;

        if (now - lastTapRef.current < 300) {
          // Double tap detected
          e.preventDefault();
          e.stopPropagation();
          if (state.scale > 1) {
            // Zoom out
            state.scale = 1;
            state.translateX = 0;
            state.translateY = 0;
          } else {
            // Zoom in to 2x at tap location
            const container = containerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              const tapX = e.clientX || (e.changedTouches?.[0]?.clientX ?? rect.left + rect.width / 2);
              const tapY = e.clientY || (e.changedTouches?.[0]?.clientY ?? rect.top + rect.height / 2);
              const offsetX = tapX - rect.left - rect.width / 2;
              const offsetY = tapY - rect.top - rect.height / 2;
              state.scale = 2;
              state.translateX = -offsetX;
              state.translateY = -offsetY;
              clampTranslation();
            }
          }
          updateTransform();
          lastTapRef.current = 0; // Reset to prevent triple-tap issues
        } else {
          lastTapRef.current = now;
        }
      }, [clampTranslation, updateTransform]);

      const handleImgLoad = useCallback((e) => {
        const img = e.target;
        if (img) {
          setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
        }
        setImgLoaded(true);
        onLoad?.(e);
      }, [onLoad]);

      const handleImgError = useCallback((e) => {
        setImgLoaded(true);
        onError?.(e);
      }, [onError]);

      // Scroll zoom for desktop only
      const handleWheel = useCallback((e) => {
        // Only enable scroll zoom on desktop
        if (isMobileDevice()) return;

        e.preventDefault();
        e.stopPropagation();

        const state = stateRef.current;
        const container = containerRef.current;
        if (!container) return;

        const oldScale = state.scale;

        // Calculate zoom delta (negative deltaY = zoom in, positive = zoom out)
        const zoomDelta = -e.deltaY * 0.002;
        let newScale = state.scale * (1 + zoomDelta);

        // Clamp to min/max scale
        newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

        // Don't do anything if scale didn't change
        if (newScale === oldScale) return;

        // Get container rect
        const containerRect = container.getBoundingClientRect();

        // Mouse position relative to container center (since image is centered)
        const mouseX = e.clientX - containerRect.left - containerRect.width / 2;
        const mouseY = e.clientY - containerRect.top - containerRect.height / 2;

        // The zoom ratio
        const zoomRatio = newScale / oldScale;

        // Point under mouse in image space (accounting for current translation)
        // The image center is at (0,0) + translate, so point on image = mousePos - translate
        const pointX = mouseX - state.translateX;
        const pointY = mouseY - state.translateY;

        // After zoom, we want the same point to stay under the mouse
        // newTranslate = mousePos - pointOnImage * zoomRatio
        state.translateX = mouseX - pointX * zoomRatio;
        state.translateY = mouseY - pointY * zoomRatio;
        state.scale = newScale;

        // Reset translation if zooming back to 1
        if (newScale <= 1) {
          state.translateX = 0;
          state.translateY = 0;
        }

        clampTranslation();
        updateTransform();
      }, [clampTranslation, updateTransform]);

      // Mouse drag for desktop only
      const handleMouseDown = useCallback((e) => {
        // Only enable drag on desktop when zoomed in
        if (isMobileDevice()) return;

        const state = stateRef.current;
        if (state.scale > 1) {
          e.preventDefault();
          e.stopPropagation();
          state.isMouseDragging = true;
          state.lastMouseX = e.clientX;
          state.lastMouseY = e.clientY;
          // Change cursor to grabbing
          if (containerRef.current) {
            containerRef.current.style.cursor = 'grabbing';
          }
        }
      }, []);

      const handleMouseMove = useCallback((e) => {
        const state = stateRef.current;
        if (state.isMouseDragging && state.scale > 1) {
          e.preventDefault();
          e.stopPropagation();
          const deltaX = e.clientX - state.lastMouseX;
          const deltaY = e.clientY - state.lastMouseY;
          state.translateX += deltaX;
          state.translateY += deltaY;
          state.lastMouseX = e.clientX;
          state.lastMouseY = e.clientY;

          clampTranslation();
          updateTransform();
        }
      }, [clampTranslation, updateTransform]);

      const handleMouseUp = useCallback(() => {
        const state = stateRef.current;
        if (state.isMouseDragging) {
          state.isMouseDragging = false;
          // Change cursor back to grab
          if (containerRef.current) {
            containerRef.current.style.cursor = state.scale > 1 ? 'grab' : 'default';
          }
        }
      }, []);

      const handleMouseLeave = useCallback(() => {
        const state = stateRef.current;
        if (state.isMouseDragging) {
          state.isMouseDragging = false;
          // Change cursor back
          if (containerRef.current) {
            containerRef.current.style.cursor = state.scale > 1 ? 'grab' : 'default';
          }
        }
      }, []);

      // Update cursor when scale changes
      useEffect(() => {
        const container = containerRef.current;
        if (!container || isMobileDevice()) return;

        const state = stateRef.current;
        container.style.cursor = state.scale > 1 ? 'grab' : 'default';
      }, [imgLoaded]);

      return H('div', {
        ref: containerRef,
        className: 'pinch-zoom-container',
        style: {
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none'
        },
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onClick: handleTap,
        onWheel: handleWheel,
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onMouseLeave: handleMouseLeave
      },
        (() => {
          // Calculate displayed image size based on zoom level
          // At scale 1: fit to container. At scale > 1: scale up to native resolution max.
          const container = containerRef.current;
          let imgStyle = {
            ...(style || {}),
            opacity: imgLoaded ? (style?.opacity ?? 1) : 0,
            transition: isZoomed ? 'none' : 'opacity 180ms ease',
            transformOrigin: 'center center',
            willChange: 'transform',
            pointerEvents: 'none'
          };

          if (isZoomed && naturalSize.width && naturalSize.height && container) {
            const containerRect = container.getBoundingClientRect();
            // Calculate base size (how big it would be at scale 1 to fit container)
            const containerAspect = containerRect.width / containerRect.height;
            const imgAspect = naturalSize.width / naturalSize.height;
            let baseWidth, baseHeight;
            if (imgAspect > containerAspect) {
              baseWidth = containerRect.width;
              baseHeight = containerRect.width / imgAspect;
            } else {
              baseHeight = containerRect.height;
              baseWidth = containerRect.height * imgAspect;
            }
            // Scale up but cap at native resolution for sharp pixels
            const targetWidth = Math.min(naturalSize.width, baseWidth * currentScale);
            const targetHeight = Math.min(naturalSize.height, baseHeight * currentScale);
            imgStyle.width = `${targetWidth}px`;
            imgStyle.height = `${targetHeight}px`;
            imgStyle.maxWidth = 'none';
            imgStyle.maxHeight = 'none';
            imgStyle.objectFit = 'none';
          } else {
            imgStyle.maxWidth = '100%';
            imgStyle.maxHeight = '100%';
            imgStyle.objectFit = 'contain';
          }

          return H('img', {
            ref: imgRef,
            src: src,
            alt: alt,
            draggable: false,
            className: className || 'lightbox-img',
            onLoad: handleImgLoad,
            onError: handleImgError,
            style: imgStyle
          });
        })()
      );
    }

    function ListingGalleryModal({ open, images, index, onClose, onIndex, loading = false }) {
      useBodyScrollLock(open);

      const list = Array.isArray(images) ? images.filter(Boolean) : [];
      const len = list.length;
      const safeIndex = len ? Math.min(Math.max(Number(index) || 0, 0), len - 1) : 0;
      const canNavigate = len > 1 && typeof onIndex === 'function';
      const currentSrc = len ? list[safeIndex] : '';

      const [stageLoaded, setStageLoaded] = React.useState(false);

      // Zoom state - simple CSS transform approach (same as DM lightbox)
      const [zoom, setZoom] = React.useState(1);
      const [pan, setPan] = React.useState({ x: 0, y: 0 });
      const [isDragging, setIsDragging] = React.useState(false);
      const containerRef = React.useRef(null);
      const touchStartRef = React.useRef(null);
      const lastPinchDistRef = React.useRef(null);
      const isPanningRef = React.useRef(false);
      const lastPanRef = React.useRef({ x: 0, y: 0 });
      const mouseStartRef = React.useRef(null);

      // Reset zoom when image changes or modal closes
      React.useEffect(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setStageLoaded(false);
      }, [open, currentSrc]);

      const handleStageSettled = React.useCallback(() => {
        setStageLoaded(true);
      }, []);

      React.useEffect(() => {
        if (!open) return;
        if (index !== safeIndex) {
          onIndex?.(safeIndex);
        }
      }, [open, safeIndex, index, onIndex]);

      React.useEffect(() => {
        if (!open) return;
        const handler = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            onClose?.();
            return;
          }
          if (!canNavigate) return;
          if (evt.key === 'ArrowRight') {
            evt.preventDefault();
            onIndex?.((safeIndex + 1) % len);
          } else if (evt.key === 'ArrowLeft') {
            evt.preventDefault();
            onIndex?.((safeIndex - 1 + len) % len);
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [open, canNavigate, safeIndex, len, onClose, onIndex]);

      // Pinch-to-zoom for mobile
      const handleTouchStart = React.useCallback((e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
          isPanningRef.current = false;
        } else if (e.touches.length === 1 && zoom > 1) {
          e.preventDefault();
          isPanningRef.current = true;
          touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          lastPanRef.current = { ...pan };
        }
      }, [zoom, pan]);

      const handleTouchMove = React.useCallback((e) => {
        if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const scale = dist / lastPinchDistRef.current;
          setZoom(z => Math.min(Math.max(z * scale, 1), 5));
          lastPinchDistRef.current = dist;
        } else if (e.touches.length === 1 && isPanningRef.current && touchStartRef.current && zoom > 1) {
          e.preventDefault();
          const dx = e.touches[0].clientX - touchStartRef.current.x;
          const dy = e.touches[0].clientY - touchStartRef.current.y;
          setPan({
            x: lastPanRef.current.x + dx,
            y: lastPanRef.current.y + dy
          });
        }
      }, [zoom]);

      const handleTouchEnd = React.useCallback((e) => {
        if (e.touches.length < 2) {
          lastPinchDistRef.current = null;
        }
        if (e.touches.length === 0) {
          isPanningRef.current = false;
          touchStartRef.current = null;
          if (zoom <= 1) {
            setPan({ x: 0, y: 0 });
          }
        }
      }, [zoom]);

      // Mouse drag for desktop
      const handleMouseDown = React.useCallback((e) => {
        if (zoom > 1 && e.button === 0) {
          e.preventDefault();
          setIsDragging(true);
          mouseStartRef.current = { x: e.clientX, y: e.clientY };
          lastPanRef.current = { ...pan };
        }
      }, [zoom, pan]);

      const handleMouseMove = React.useCallback((e) => {
        if (isDragging && mouseStartRef.current && zoom > 1) {
          e.preventDefault();
          const dx = e.clientX - mouseStartRef.current.x;
          const dy = e.clientY - mouseStartRef.current.y;
          setPan({
            x: lastPanRef.current.x + dx,
            y: lastPanRef.current.y + dy
          });
        }
      }, [isDragging, zoom]);

      const handleMouseUp = React.useCallback(() => {
        setIsDragging(false);
        mouseStartRef.current = null;
      }, []);

      // Attach mouse move/up to window when dragging
      React.useEffect(() => {
        if (isDragging) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
          return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };
        }
      }, [isDragging, handleMouseMove, handleMouseUp]);

      // Scroll-to-zoom for desktop - zooms toward cursor position
      const handleWheel = React.useCallback((e) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;

        setZoom(prevZoom => {
          const newZoom = Math.min(Math.max(prevZoom * delta, 1), 5);

          if (newZoom <= 1) {
            setPan({ x: 0, y: 0 });
          } else {
            // Adjust pan to zoom toward cursor
            const zoomRatio = newZoom / prevZoom;
            setPan(prevPan => ({
              x: mouseX - (mouseX - prevPan.x) * zoomRatio,
              y: mouseY - (mouseY - prevPan.y) * zoomRatio
            }));
          }

          return newZoom;
        });
      }, []);

      // Double-tap/click to toggle zoom
      const lastTapRef = React.useRef(0);
      const handleDoubleTap = React.useCallback((e) => {
        if (isDragging) return;
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          e.preventDefault();
          if (zoom > 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            // Zoom in toward tap/click position
            const container = containerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              const tapX = (e.clientX || e.changedTouches?.[0]?.clientX || rect.left + rect.width / 2) - rect.left - rect.width / 2;
              const tapY = (e.clientY || e.changedTouches?.[0]?.clientY || rect.top + rect.height / 2) - rect.top - rect.height / 2;
              setZoom(2.5);
              setPan({ x: -tapX * 1.5, y: -tapY * 1.5 });
            } else {
              setZoom(2.5);
            }
          }
        }
        lastTapRef.current = now;
      }, [zoom, isDragging]);

      const handleBackdropClick = React.useCallback((evt) => {
        if (evt.target.classList.contains('lightbox-backdrop') ||
          evt.target.classList.contains('lightbox-overlay')) {
          onClose?.();
        }
      }, [onClose]);

      if (!open) return null;

      const stageOverlay = (!stageLoaded && currentSrc) || (loading && !len)
        ? H('div', { className: 'lightbox-stage-skeleton', 'aria-hidden': true })
        : null;

      const imageContent = len
        ? H('div', {
            className: 'lightbox-main',
            ref: containerRef,
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
            onWheel: handleWheel,
            onClick: handleDoubleTap,
            style: { touchAction: 'none', overflow: 'hidden', userSelect: 'none', position: 'relative' }
          },
          H('img', {
            src: currentSrc,
            alt: `Listing image ${safeIndex + 1}`,
            className: 'lightbox-img',
            draggable: false,
            onLoad: handleStageSettled,
            onError: handleStageSettled,
            style: {
              opacity: stageLoaded ? 1 : 0,
              transition: zoom === 1 ? 'transform 0.2s ease-out, opacity 180ms ease' : 'opacity 180ms ease',
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              pointerEvents: 'none'
            }
          }),
          // Navigation arrows attached to the lightbox
          canNavigate && H('button', {
            onClick: (e) => { e.stopPropagation(); onIndex?.((safeIndex - 1 + len) % len); },
            'aria-label': 'Previous',
            style: {
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: 44,
              height: 44,
              fontSize: 28,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10
            }
          }, '‹'),
          canNavigate && H('button', {
            onClick: (e) => { e.stopPropagation(); onIndex?.((safeIndex + 1) % len); },
            'aria-label': 'Next',
            style: {
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: 44,
              height: 44,
              fontSize: 28,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10
            }
          }, '›'),
          // Image counter (only if multiple images)
          len > 1 && H('div', {
            style: {
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 12,
              fontSize: 12,
              pointerEvents: 'none'
            }
          }, `${safeIndex + 1} / ${len}`),
          // Zoom indicator
          zoom > 1 && H('div', {
            style: {
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 12,
              fontSize: 11,
              pointerEvents: 'none'
            }
          }, `${Math.round(zoom * 100)}%`)
        )
        : H('div', { className: 'lightbox-main' },
          H('div', { className: 'lightbox-empty' }, loading ? null : 'No images available')
        );

      const overlayContent = H('div', { className: 'lightbox-content', role: 'dialog', 'aria-modal': true },
        H('button', { className: 'lightbox-close', onClick: onClose, 'aria-label': 'Close gallery' }, '×'),
        stageOverlay,
        imageContent
      );

      return ReactDOM.createPortal(
        H('div', {
          className: 'lightbox-overlay open',
          role: 'presentation',
          onClick: handleBackdropClick
        },
          H('div', { className: 'lightbox-backdrop' }),
          overlayContent
        ),
        document.body
      );
    }

    const ListingCard = React.memo(function ListingCard({
      item,
      canEdit,
      onEdit,
      onDelete,
      user,
      onMessage,
      onAdminDelete,
      onViewSeller,
      onToggleSold,
      onSupporterClick,
      showDistance = false,
      viewContext = 'grid',
      isSaved = false,
      onToggleSave
    }) {

      // Use full-size image for detail view, not thumbnail
      const fullCover = item?.__fullCover || item?.__cover;
      const fallbackImages = useMemo(() => collectListingImages(item, fullCover), [item, fullCover]);
      const baseGallery = useMemo(() => {
        const fallbackList = Array.isArray(fallbackImages) ? fallbackImages : [];
        const inlineList = Array.isArray(item?.images) ? item.images : [];
        return dedupeImageUrls([...fallbackList, ...inlineList]);
      }, [item?.images, fallbackImages]);

      const [galleryImages, setGalleryImages] = useState(baseGallery);
      const [galleryOpen, setGalleryOpen] = useState(false);
      const [galleryIndex, setGalleryIndex] = useState(0);
      const [galleryLoading, setGalleryLoading] = useState(false);
      const [showReport, setShowReport] = useState(false);
      const [derivedMeters, setDerivedMeters] = React.useState(null);
      const [showProfilePreview, setShowProfilePreview] = useState(false);
      const [profileData, setProfileData] = useState(null);

      const isModalView = viewContext === 'modal';

      const normalizedBaseGallery = useMemo(() => {
        if (Array.isArray(baseGallery) && baseGallery.length) return baseGallery;
        // Prefer full-size image for detail view
        const fallbackCover = item.image_data || item.__fullCover || item.__cover || item.thumb_url || '';
        return fallbackCover ? [fallbackCover] : [];
      }, [baseGallery, item.image_data, item.__fullCover, item.__cover, item.thumb_url]);

      const sameList = useCallback((a, b) => {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false;
        }
        return true;
      }, []);

      const baseImageCount = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery.length : 0;

      const prefetchImages = useCallback(() => {
        if (!item?.id) return;
        if (listingImageInFlight.has(item.id)) return;
        const minCount = baseImageCount + 1;
        const cached = listingImageCache.get(item.id);
        if (Array.isArray(cached) && cached.length >= minCount) return;
        fetchListingImagesCached(item.id, { minCount });
      }, [item?.id, baseImageCount]);

      React.useEffect(() => {
        const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
        setGalleryImages(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          return sameList(prevList, baseList) ? prevList : baseList;
        });
      }, [normalizedBaseGallery, sameList]);

      React.useEffect(() => {
        if (!item?.id) return;
        const cached = listingImageCache.get(item.id);
        if (Array.isArray(cached) && cached.length) {
          const cachedList = dedupeImageUrls(cached);
          setGalleryImages(prev => sameList(prev, cachedList) ? prev : cachedList);
        }
      }, [item?.id, sameList]);

      const handleOpenGallery = useCallback(async (start = 0) => {
        const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
        setGalleryIndex(Number.isFinite(start) ? start : 0);
        setGalleryImages(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          return sameList(prevList, baseList) ? prevList : baseList;
        });
        setGalleryOpen(true);
        prefetchImages();

        if (!item?.id) return;

        setGalleryLoading(true);
        try {
          const fetched = await fetchListingImagesCached(item.id, { minCount: baseList.length + 1 });
          const merged = dedupeImageUrls([...baseList, ...(Array.isArray(fetched) ? fetched : [])]);
          if (merged.length) {
            listingImageCache.set(item.id, merged);
          }
          setGalleryImages(prev => sameList(prev, merged) ? prev : merged);
        } catch (err) {
          console.warn('Failed to load gallery images for listing', item?.id, err);
        } finally {
          setGalleryLoading(false);
        }
      }, [item?.id, normalizedBaseGallery, sameList, prefetchImages]);

      React.useEffect(() => {
        if (!item?.id) return;
        if (!Array.isArray(galleryImages) || !galleryImages.length) return;
        const baseLen = baseImageCount;
        if (galleryImages.length <= baseLen) return;
        listingImageCache.set(item.id, galleryImages);
      }, [galleryImages, item?.id, baseImageCount]);

      React.useEffect(() => {
        if (!galleryOpen) return;
        const len = Array.isArray(galleryImages) ? galleryImages.length : 0;
        if (!len) {
          if (galleryIndex !== 0) setGalleryIndex(0);
          return;
        }
        if (galleryIndex >= len) {
          setGalleryIndex(len - 1);
        } else if (galleryIndex < 0) {
          setGalleryIndex(0);
        }
      }, [galleryOpen, galleryImages, galleryIndex]);

      React.useEffect(() => {
        if (!showDistance) {
          setDerivedMeters(null);
          return;
        }
        let fromServer = null;
        if (Number.isFinite(item?.distance_m)) fromServer = item.distance_m;
        if (Number.isFinite(item?.distance_ft)) fromServer = item.distance_ft / 3.28084;
        if (fromServer != null) {
          setDerivedMeters(fromServer);
          return;
        }

        let isMounted = true;
        if (Number.isFinite(item?.lat) && Number.isFinite(item?.lon)) {
          getUserCoordsOnce().then(coords => {
            if (!isMounted || !coords) return;
            const m = haversineMeters(coords.lat, coords.lon, item.lat, item.lon);
            setDerivedMeters(m);
          }).catch(() => {});
        } else {
          setDerivedMeters(null);
        }
        return () => { isMounted = false; };
      }, [showDistance, item?.id, item?.lat, item?.lon]);

      const isFree = Number(item?.price ?? 0) === 0;
      const markedFree = !!item?.is_free;
      const wantsOffer = !!item?.inquiry_enabled;
      const [soldBusy, setSoldBusy] = useState(false);
      const [saveBusy, setSaveBusy] = useState(false);
      // Local saved state for immediate UI feedback
      const [localSaved, setLocalSaved] = useState(isSaved);
      // Sync local state with prop when prop changes
      useEffect(() => {
        setLocalSaved(isSaved);
      }, [isSaved]);
      const galleryCount = Array.isArray(galleryImages) ? galleryImages.length : 0;
      const coverSrc = item.image_data || (galleryCount ? galleryImages[0] : '');

      // Build viewer action icons (Message, Save, Report) for non-owners
      const isViewer = !user || user.id !== item.user_id;
      const canReport = user && user.id !== item.user_id;
      const canSave = user && user.id !== item.user_id && onToggleSave;
      const viewerActions = isViewer ? H('div', {
        className: 'listing-viewer-actions',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginLeft: 'auto'
        }
      },
        // Message pill
        H('button', {
          key: 'm',
          className: 'listing-action-pill listing-action-message',
          onClick: () => onMessage?.(item),
          style: {
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            padding: '4px 10px',
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }
        }, 'Message seller'),
        // Vertical stack: Bookmark on top, Report flag below
        (canSave || canReport) && H('div', {
          key: 'icon-stack',
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0
          }
        },
          // Save/Bookmark icon on top
          canSave && H('button', {
            key: 'save',
            className: 'listing-action-icon listing-action-save' + (localSaved ? ' is-saved' : ''),
            onClick: async () => {
              if (saveBusy) return;
              try {
                setSaveBusy(true);
                // Optimistic update - change UI immediately
                setLocalSaved(!localSaved);
                await onToggleSave(item, !localSaved);
              } finally {
                setSaveBusy(false);
              }
            },
            disabled: saveBusy,
            title: localSaved ? 'Remove from saved' : 'Save listing',
            style: {
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 6,
              cursor: saveBusy ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saveBusy ? 0.5 : 1
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: localSaved ? '#3b82f6' : 'none',
              stroke: localSaved ? '#3b82f6' : 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' })
            )
          ),
          // Report icon below (only if logged in)
          canReport && H('button', {
            key: 'report',
            className: 'listing-action-icon listing-action-report',
            onClick: () => setShowReport(true),
            title: 'Report seller',
            style: {
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }),
              H('line', { x1: 4, y1: 22, x2: 4, y2: 15 })
            )
          )
        )
      ) : null;

      // Build owner action icons (Edit, Sold, Delete)
      const isSold = !!item?.sold;
      const ownerActions = canEdit ? H('div', {
        className: 'listing-owner-actions',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: 'auto'
        }
      },
        // Edit icon
        H('button', {
          key: 'e',
          className: 'listing-action-icon',
          onClick: () => onEdit?.(item),
          title: 'Edit listing',
          style: {
            background: 'transparent',
            border: 'none',
            padding: 6,
            borderRadius: 6,
            cursor: 'pointer',
            color: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }
        },
          H('svg', {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
            H('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
            H('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' })
          )
        ),
        // Sold toggle icon
        onToggleSold && H('button', {
          key: 'sold-toggle',
          className: 'listing-action-icon listing-action-sold' + (isSold ? ' is-sold' : ''),
          onClick: async () => {
            if (soldBusy) return;
            try {
              setSoldBusy(true);
              await onToggleSold(item, !isSold);
            } finally {
              setSoldBusy(false);
            }
          },
          disabled: soldBusy,
          title: isSold ? 'Mark as unsold' : 'Mark as sold',
          style: {
            background: 'transparent',
            border: 'none',
            padding: 6,
            borderRadius: 6,
            cursor: soldBusy ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: soldBusy ? 0.5 : 1
          }
        },
          H('svg', {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: isSold ? 'currentColor' : 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
            H('path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }),
            H('polyline', { points: '22 4 12 14.01 9 11.01' })
          )
        ),
        // Delete icon
        H('button', {
          key: 'd',
          className: 'listing-action-icon',
          onClick: () => onDelete?.(item),
          title: 'Remove listing',
          style: {
            background: 'transparent',
            border: 'none',
            padding: 6,
            borderRadius: 6,
            cursor: 'pointer',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }
        },
          H('svg', {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
            H('polyline', { points: '3 6 5 6 21 6' }),
            H('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })
          )
        )
      ) : null;

      // Admin delete (keep as button for visibility)
      const adminControls = [];
      if (user?.is_admin) {
        adminControls.push(H('button', {
          key: 'admin-del',
          className: 'btn danger',
          style: { fontSize: 12, padding: '4px 10px' },
          onClick: async () => {
            if (!confirm('Admin: Delete this listing?')) return;
            await api.adminDeleteListing(item.id);
            onAdminDelete?.(item.id);
          }
        }, 'Admin Delete'));
      }

      const supporterData = item?.owner_supporter_badge ? {
        username: item?.owner_username ? item.owner_username : null,
        since: item?.owner_supporter_since || null,
        badge: item?.owner_supporter_badge || null,
        tier: item?.owner_supporter_tier || null
      } : null;

      const handleSupporterBadgeClick = () => {
        if (!supporterData) return;
        const payload = {
          username: supporterData.username || (item?.owner_username ? item.owner_username : 'This seller'),
          since: supporterData.since || null,
          tier: supporterData.tier || null
        };
        onSupporterClick?.(payload);
      };

      const handleShowProfilePreview = useCallback(async (userId) => {
        if (!api || typeof api.getUser !== 'function') return;
        try {
          const userData = await api.getUser(userId, { silent: true });
          // Fetch listings to calculate active/sold counts
          const listings = await api.listByUser(userId, { silent: true });
          const activeCount = Array.isArray(listings) ? listings.filter(l => !l.sold).length : 0;
          const soldCount = Array.isArray(listings) ? listings.filter(l => l.sold).length : 0;
          // Add counts to user data
          const dataWithCounts = {
            ...userData,
            active_listing_count: activeCount,
            sold_listing_count: soldCount
          };
          setProfileData(dataWithCounts);
          setShowProfilePreview(true);
        } catch (err) {
          console.warn('Failed to load profile data:', err);
        }
      }, [api]);

      const renderSellerInfo = () => {
        if (!item.owner_username) {
          return '--';
        }

        const sellerPill = onViewSeller
          ? H('button', {
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              handleShowProfilePreview(item.user_id);
            },
            style: {
              background: '#dbeafe',
              border: 'none',
              color: '#1d4ed8',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 13,
              display: 'inline-block'
            }
          }, item.owner_username)
          : H('span', {
            style: {
              background: '#dbeafe',
              color: '#1d4ed8',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 13,
              display: 'inline-block'
            }
          }, item.owner_username);

        if (!supporterData) {
          return sellerPill;
        }

        return H('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
        },
          sellerPill,
          H(TieredSupporterBadge, {
            since: supporterData.since,
            tier: supporterData.tier,
            size: 18
          })
        );
      };

      const openGalleryFromEvent = useCallback((evt) => {
        if (evt && typeof evt.preventDefault === 'function') {
          evt.preventDefault();
        }
        if (evt && typeof evt.stopPropagation === 'function') {
          evt.stopPropagation();
        }
        handleOpenGallery(0);
      }, [handleOpenGallery]);

      const cardEventProps = isModalView ? {} : {
        onMouseEnter: prefetchImages,
        onFocus: prefetchImages,
        onPointerDown: prefetchImages,
        onTouchStart: prefetchImages
      };

      return H('div', { className: 'card', ...cardEventProps, tabIndex: -1 },
        H('div', {
          className: 'aspect',
          onClick: openGalleryFromEvent,
          style: {
            cursor: 'zoom-in',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 8
          }
        },
          coverSrc
            ? H(ResponsiveImage, {
              src: coverSrc,
              alt: item.title || 'Listing image',
              style: { width: '100%', height: '100%', objectFit: 'cover' },
              sizes: '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 33vw',
              loading: isModalView ? 'eager' : 'lazy',
              decoding: 'async',
              fetchPriority: isModalView ? 'high' : 'auto',
              onClick: openGalleryFromEvent
            })
            : H('div', {
              style: {
                width: '100%',
                height: '100%',
                background: '#f3f4f6',
                display: 'grid',
                placeItems: 'center',
                color: '#6b7280',
                fontWeight: 600
              }
            }, 'No image'),
          item.sold ? H('div', {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }
          },
            H('div', {
              style: {
                transform: 'rotate(-18deg)',
                padding: '6px 18px',
                textTransform: 'uppercase',
                letterSpacing: '6px',
                fontWeight: 800,
                fontSize: 26,
                color: 'rgba(4, 120, 87, 0.85)',
                border: '3px solid rgba(16, 185, 129, 0.55)',
                background: 'rgba(229, 255, 244, 0.82)',
                borderRadius: 999
              }
            }, 'Sold')
          ) : null,
          wantsOffer ? H('span', {
            className: 'inquiry-badge',
            style: {
              position: 'absolute',
              bottom: 8,
              right: 8,
              fontSize: 11,
              pointerEvents: 'none'
            }
          }, 'Seller wants an offer') : null,
          markedFree ? H('span', {
            style: {
              position: 'absolute',
              bottom: 8,
              right: 8,
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              background: '#ec4899',
              color: '#fff',
              borderRadius: 4,
              pointerEvents: 'none',
              textTransform: 'uppercase',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }
          }, 'Free') : null
        ),
        H('div', { style: { padding: 16 } },
          H('div', {
            className: 'row',
            style: { justifyContent: 'space-between', alignItems: 'start' }
          },
            H('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              H('div', { style: { fontWeight: 800 } }, item.title || 'Item for sale'),
              H('div', { className: 'muted listing-description' }, item.description)
            ),
            H('div', {
              style: {
                fontWeight: 800,
                textAlign: 'right',
                color: isFree ? '#16a34a' : '#111',
                flexShrink: 0
              }
            }, price(item.price))
          ),

          H('div', { className: 'muted' }, item.location || 'No location'),

          item.created_at && H('div', { className: 'muted' }, 'Listed ' + formatRelativeTime(item.created_at)),

          (showDistance && derivedMeters != null) &&
          H('div', { className: 'distance' }, fmtDistance(derivedMeters) + ' away'),

          H('div', { className: 'muted', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            renderSellerInfo(),
            ownerActions,
            viewerActions
          ),

          adminControls.length > 0 && H('div', {
            className: 'row',
            style: { marginTop: 6, justifyContent: 'flex-start', gap: 8 }
          }, ...adminControls)
        ),

        showReport && H(ReportSellerModal, {
          open: showReport,
          listing: item,
          onClose: () => setShowReport(false)
        }),

        showProfilePreview && H(ProfilePreviewModal, {
          sellerInfo: profileData,
          activeListingCount: profileData?.active_listing_count || 0,
          soldListingCount: profileData?.sold_listing_count || 0,
          onClose: () => setShowProfilePreview(false),
          onVisitProfile: () => {
            setShowProfilePreview(false);
            onViewSeller?.(item.user_id, item.owner_username);
          },
          onMessage: () => onMessage?.(item),
          onSupporterClick
        }),

        H(ListingGalleryModal, {
          open: galleryOpen,
          images: galleryImages,
          index: galleryIndex,
          onClose: () => setGalleryOpen(false),
          onIndex: setGalleryIndex,
          loading: galleryLoading
        })
      );
    }, (prev, next) => {
      if (prev.item === next.item) return true;
      if (!prev.item || !next.item) return false;
      return (
        prev.item.id === next.item.id &&
        prev.item.updated_at === next.item.updated_at &&
        prev.item.sold === next.item.sold &&
        prev.item.price === next.item.price &&
        prev.item.title === next.item.title &&
        prev.item.description === next.item.description &&
        prev.item.__cover === next.item.__cover &&
        prev.item.inquiry_enabled === next.item.inquiry_enabled &&
        prev.item.is_free === next.item.is_free &&
        prev.showDistance === next.showDistance &&
        prev.canEdit === next.canEdit &&
        prev.user?.id === next.user?.id &&
        prev.isSaved === next.isSaved
      );
    });

    const formatElapsedSince = (input) => {
      if (!input) return null;
      const date = new Date(input);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      let diff = Date.now() - date.getTime();
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
        const value = Math.floor(diff / unit.ms);
        if (value >= 1) {
          return `${value} ${unit.label}${value === 1 ? '' : 's'} ago`;
        }
      }
      return 'just now';
    };

    // --- Profile Preview Modal (Discord-like) ---
    function ProfilePreviewModal({ sellerInfo, activeListingCount, soldListingCount, onClose, onVisitProfile, onMessage, onSupporterClick }) {
      // Add modal-open class to body when modal opens (hides mobile tab bar)
      useEffect(() => {
        if (sellerInfo) {
          document.body.classList.add('modal-open');
          return () => document.body.classList.remove('modal-open');
        }
      }, [sellerInfo]);

      if (!sellerInfo) return null;

      const sellerJoinedText = sellerInfo.created_at ? formatElapsedSince(sellerInfo.created_at) : null;
      const sellerSupporter = sellerInfo.supporter_badge
        ? {
          username: sellerInfo.username,
          since: sellerInfo.supporter_since,
          badge: sellerInfo.supporter_badge,
          tier: sellerInfo.supporter_tier
        }
        : null;
      const avatarBorderColor = sellerInfo.profile_avatar_border_color || '#ffffff';
      const avatarBorderStyle = sellerInfo.profile_avatar_border_style === 'dashed' ? 'dashed' : 'solid';
      const bgImageUrlSource = sellerInfo.profile_bg_image_url || sellerInfo.profile_bg_video_url;
      const bgImageUrl = typeof bgImageUrlSource === 'string' && bgImageUrlSource.trim()
        ? bgImageUrlSource.trim()
        : null;
      const avatarUrl = typeof sellerInfo.profile_picture_url === 'string' && sellerInfo.profile_picture_url.trim()
        ? sellerInfo.profile_picture_url.trim()
        : null;
      const username = sellerInfo.username || 'Seller';
      const initials = username.trim().slice(0, 1).toUpperCase() || 'S';
      const activeCount = Math.max(0, Number(activeListingCount) || 0);
      const soldCount = Math.max(0, Number(soldListingCount) || 0);
      const karmaValue = Number.isFinite(Number(sellerInfo.karma)) ? Number(sellerInfo.karma) : null;
      const stats = [
        { label: 'Active listings', value: activeCount },
        { label: 'Sold', value: soldCount },
        ...(karmaValue && karmaValue > 0 ? [{ label: 'Karma', value: karmaValue, isKarma: true }] : [])
      ];
      const avatarSize = 96;
      const avatarOverlap = 34;
      const avatarBorderWidth = 4;
      const sellerAboutText = typeof sellerInfo.profile_about === 'string' && sellerInfo.profile_about.trim()
        ? sellerInfo.profile_about.trim()
        : null;

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const statCard = (stat) => H('div', {
        key: stat.label,
        style: {
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 14,
          padding: '12px 14px',
          minWidth: 0
        }
      },
        H('div', {
          style: {
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#94a3b8'
          }
        }, stat.label),
        H('div', {
          style: {
            marginTop: 4,
            fontSize: 22,
            fontWeight: 800,
            color: '#f8fafc'
          }
        }, Number.isFinite(stat.value) ? stat.value.toLocaleString() : '0')
      );

      const pillStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        border: '1px solid rgba(148, 163, 184, 0.4)',
        background: 'rgba(51, 65, 85, 0.35)',
        fontSize: 12,
        color: '#cbd5f5',
        fontWeight: 600
      };

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick,
          style: { background: 'rgba(0, 0, 0, 0.75)', padding: 12 }
        },
          H('div', {
            className: 'modal-inner',
            role: 'dialog',
            'aria-modal': true,
            style: {
              padding: 0,
              width: 'min(420px, 94vw)',
              background: 'transparent',
              borderRadius: 24,
              boxShadow: 'none'
            }
          },
            H('div', {
              style: {
                background: '#0f172a',
                borderRadius: 24,
                color: '#f8fafc',
                overflow: 'auto',
                position: 'relative',
                boxShadow: '0 35px 90px rgba(0, 0, 0, 0.55)',
                fontFamily: 'Inter, system-ui',
                maxHeight: '85vh',
                maxWidth: '600px',
                width: '90vw'
              }
            },
              H('button', {
                type: 'button',
                onClick: () => onClose?.(),
                style: {
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '1px solid rgba(148, 163, 184, 0.4)',
                  background: 'rgba(15, 23, 42, 0.45)',
                  color: '#f8fafc',
                  fontSize: 18,
                  cursor: 'pointer'
                }
              }, '×'),
              H('div', {
                style: {
                  position: 'relative',
                  minHeight: 200,
                  paddingBottom: avatarOverlap + 10
                }
              },
                H('div', {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    background: 'linear-gradient(120deg, #1d1f3b, #3730a3)'
                  }
                },
                  bgImageUrl
                    ? H(ImageWithSkeleton, {
                      key: bgImageUrl,
                      src: bgImageUrl,
                      alt: `${username} banner`,
                      style: {
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }
                    })
                    : H('div', {
                      style: {
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 48,
                        color: 'rgba(248, 250, 252, 0.5)'
                      }
                    }, '🖼️'),
                  H('div', {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, rgba(2, 6, 23, 0) 40%, rgba(2, 6, 23, 0.9) 100%)'
                    }
                  })
                ),
                H('div', {
                  style: {
                    position: 'absolute',
                    left: 24,
                    bottom: -avatarOverlap,
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: '50%',
                    border: `${avatarBorderWidth}px ${avatarBorderColor} ${avatarBorderStyle}`,
                    background: '#0f172a',
                    boxShadow: '0 18px 45px rgba(0, 0, 0, 0.45)',
                    overflow: 'hidden'
                  }
                },
                  avatarUrl
                    ? H('img', {
                      src: avatarUrl,
                      alt: `${username} avatar`,
                      style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                    : H('span', {
                      style: {
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 36,
                        fontWeight: 800,
                        color: '#e2e8f0'
                      }
                    }, initials)
                )
              ),
              H('div', {
                style: {
                  padding: `${avatarOverlap + 36}px 24px 26px`,
                  display: 'grid',
                  gap: 18
                }
              },
                H('div', {
                  style: {
                    display: 'grid',
                    gap: 4
                  }
                },
                  H('div', {
                    style: {
                      fontSize: 22,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap'
                    }
                  }, username,
                    sellerSupporter && H(TieredSupporterBadge, {
                      size: 18,
                      since: sellerSupporter.since,
                      tier: sellerSupporter.tier
                    }),
                    // Beta Tester Badge (separate from supporter badge)
                    sellerInfo?.beta_tester && (() => {
                      const [showBetaTooltip, setShowBetaTooltip] = React.useState(false);
                      const betaBadgeRef = React.useRef(null);

                      // Click outside to dismiss
                      React.useEffect(() => {
                        if (!showBetaTooltip) return;
                        const handleClickOutside = (e) => {
                          if (betaBadgeRef.current && !betaBadgeRef.current.contains(e.target)) {
                            setShowBetaTooltip(false);
                          }
                        };
                        document.addEventListener('click', handleClickOutside, true);
                        return () => document.removeEventListener('click', handleClickOutside, true);
                      }, [showBetaTooltip]);

                      return H('div', { ref: betaBadgeRef, style: { position: 'relative', display: 'inline-flex' } },
                        H('div', {
                          className: 'beta-tester-badge',
                          title: 'Beta Tester',
                          onClick: (e) => { e.stopPropagation(); setShowBetaTooltip(true); },
                          style: showBetaTooltip ? { transform: 'scale(1.25)' } : undefined
                        },
                          H('svg', { viewBox: '0 0 100 100', xmlns: 'http://www.w3.org/2000/svg' },
                            H('defs', null,
                              H('linearGradient', { id: 'betaBgGrad', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                                H('stop', { offset: '0%', stopColor: '#1a237e' }),
                                H('stop', { offset: '50%', stopColor: '#0d1442' }),
                                H('stop', { offset: '100%', stopColor: '#1a237e' })
                              )
                            ),
                            // Dark blue circle with gold outline
                            H('circle', { cx: '50', cy: '50', r: '42', fill: 'url(#betaBgGrad)', stroke: '#ffd700', strokeWidth: '3' }),
                            // Beta symbol (β) in gold
                            H('text', {
                              x: '50',
                              y: '62',
                              textAnchor: 'middle',
                              fontSize: '38',
                              fontWeight: 'bold',
                              fill: '#ffd700',
                              fontFamily: 'serif'
                            }, 'β')
                          )
                        ),
                        showBetaTooltip && H('div', {
                          style: {
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: 8,
                            background: 'rgba(0, 0, 0, 0.9)',
                            color: '#fff',
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            zIndex: 1000,
                            pointerEvents: 'none',
                            border: '1px solid rgba(255, 215, 0, 0.6)'
                          }
                        }, 'Beta Tester')
                      );
                    })(),
                    // Admin Badge (cosmetic only, separate from actual admin privileges)
                    sellerInfo?.admin_badge && (() => {
                      const [showAdminTooltip, setShowAdminTooltip] = React.useState(false);
                      const adminBadgeRef = React.useRef(null);

                      // Click outside to dismiss
                      React.useEffect(() => {
                        if (!showAdminTooltip) return;
                        const handleClickOutside = (e) => {
                          if (adminBadgeRef.current && !adminBadgeRef.current.contains(e.target)) {
                            setShowAdminTooltip(false);
                          }
                        };
                        document.addEventListener('click', handleClickOutside, true);
                        return () => document.removeEventListener('click', handleClickOutside, true);
                      }, [showAdminTooltip]);

                      return H('div', { ref: adminBadgeRef, style: { position: 'relative', display: 'inline-flex' } },
                        H('div', {
                          className: 'admin-badge',
                          title: 'Trovelr Admin',
                          onClick: (e) => { e.stopPropagation(); setShowAdminTooltip(true); },
                          style: showAdminTooltip ? { transform: 'scale(1.25)' } : undefined
                        },
                          H('svg', { viewBox: '0 0 100 100', xmlns: 'http://www.w3.org/2000/svg' },
                            H('defs', null,
                              H('linearGradient', { id: 'adminShieldGrad', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                                H('stop', { offset: '0%', stopColor: '#ef4444' }),
                                H('stop', { offset: '50%', stopColor: '#dc2626' }),
                                H('stop', { offset: '100%', stopColor: '#b91c1c' })
                              ),
                              H('linearGradient', { id: 'adminShieldInner', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                                H('stop', { offset: '0%', stopColor: '#fef2f2' }),
                                H('stop', { offset: '100%', stopColor: '#fecaca' })
                              )
                            ),
                            // Shield shape
                            H('path', {
                              d: 'M50 8 L85 22 L85 45 C85 65 70 82 50 92 C30 82 15 65 15 45 L15 22 Z',
                              fill: 'url(#adminShieldGrad)',
                              stroke: '#991b1b',
                              strokeWidth: '2'
                            }),
                            // Inner shield highlight
                            H('path', {
                              d: 'M50 16 L75 27 L75 45 C75 60 63 73 50 81 C37 73 25 60 25 45 L25 27 Z',
                              fill: 'url(#adminShieldInner)',
                              opacity: '0.9'
                            }),
                            // Star in center
                            H('polygon', {
                              points: '50,28 54,40 67,40 57,48 61,60 50,52 39,60 43,48 33,40 46,40',
                              fill: '#dc2626',
                              stroke: '#991b1b',
                              strokeWidth: '1'
                            })
                          )
                        ),
                        showAdminTooltip && H('div', {
                          style: {
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: 8,
                            background: 'rgba(0, 0, 0, 0.9)',
                            color: '#fff',
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            zIndex: 1000,
                            pointerEvents: 'none',
                            border: '1px solid rgba(239, 68, 68, 0.6)'
                          }
                        }, 'Trovelr Admin')
                      );
                    })()
                  ),
                  sellerJoinedText && H('div', {
                    style: { fontSize: 13, color: '#cbd5f5' }
                  }, `Trovelr since ${sellerJoinedText}`),
                  H('div', {
                    style: {
                      marginTop: 10,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap'
                    }
                  },
                    ...stats.map((stat, idx) => {
                      let icon;
                      if (stat.isKarma) {
                        // Karma icon - lightning bolt
                        icon = H('svg', {
                          viewBox: '0 0 24 24',
                          width: 14,
                          height: 14,
                          fill: 'currentColor',
                          style: { flexShrink: 0 }
                        },
                          H('path', { d: 'M13 2L3 14h8l-1 8 10-12h-8l1-8z', fill: '#fbbf24' })
                        );
                      } else if (stat.label === 'Active listings') {
                        icon = '🛍️';
                      } else if (stat.label === 'Sold') {
                        icon = '✅';
                      }

                      return H('span', {
                        key: idx,
                        style: {
                          ...pillStyle,
                          ...(stat.isKarma ? {
                            background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.15))',
                            border: '1px solid rgba(251, 191, 36, 0.4)',
                            color: '#fbbf24'
                          } : {})
                        }
                      },
                        typeof icon === 'string' ? icon : icon,
                        ' ',
                        stat.value,
                        ' ',
                        stat.isKarma ? 'karma' : (stat.label === 'Active listings' ? 'active' : 'sold')
                      );
                    })
                  )
                ),
                H('div', {
                  style: {
                    padding: '14px 18px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    borderRadius: 18,
                    border: '1px solid rgba(148, 163, 184, 0.35)'
                  }
                },
                  H('div', { style: { fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 700 } }, 'About this seller'),
                  H('p', {
                    style: {
                      margin: 0,
                      fontSize: 14,
                      color: '#e2e8f0',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word'
                    }
                  },
                    sellerAboutText
                      ? sellerAboutText
                      : (activeCount > 0
                        ? `Currently listing ${activeCount} ${activeCount === 1 ? 'item' : 'items'} with ${soldCount} sold overall.`
                        : 'No active listings right now, but their sold history speaks for itself.')
                  )
                ),
                H('div', {
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12
                  }
                },
                  H('button', {
                    type: 'button',
                    onClick: () => {
                      onMessage?.();
                      onClose?.();
                    },
                    style: {
                      flex: '1 1 150px',
                      padding: '12px 16px',
                      borderRadius: 14,
                      border: 'none',
                      background: '#3b82f6',
                      color: '#fff',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 10px 25px rgba(59, 130, 246, 0.4)'
                    }
                  }, 'Message'),
                  H('button', {
                    type: 'button',
                    onClick: () => onVisitProfile?.(),
                    style: {
                      flex: '1 1 150px',
                      padding: '12px 16px',
                      borderRadius: 14,
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      background: 'rgba(15, 23, 42, 0.5)',
                      color: '#f8fafc',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }
                  }, 'View profile')
                )
              )
            )
          )
        ),
        document.body
      );
    }

    function SellerProfile({ sellerId, sellerUsername, onBack, user, onMessage, onAdminDelete, onSupporterClick }) {
      const [listings, setListings] = useState([]);
      const [loading, setLoading] = useState(true);
      const [selectedListing, setSelectedListing] = useState(null);
      const [error, setError] = useState(null);
      const [tab, setTab] = useState('active');
      const [sellerInfo, setSellerInfo] = useState(null);
      const [coverById, setCoverById] = useState(() => (Object.create(null)));

      useEffect(() => {
        if (!Number.isFinite(Number(sellerId))) {
          setSellerInfo(null);
          return undefined;
        }
        if (!api || typeof api.getUser !== 'function') {
          setSellerInfo(null);
          return undefined;
        }

        let mounted = true;
        setSellerInfo(null);

        (async () => {
          try {
            const info = await api.getUser(sellerId, { silent: true });
            if (!mounted) return;
            if (info && typeof info === 'object') {
              setSellerInfo(info);
            }
          } catch (err) {
            if (!mounted) return;
            console.warn('Failed to load seller info:', err);
            setSellerInfo(null);
          }
        })();

        return () => { mounted = false; };
      }, [api, sellerId]);

      useEffect(() => {
        let mounted = true;

        async function fetchSellerListings() {
          if (!Number.isFinite(Number(sellerId))) {
            setListings([]);
            setError('User not found');
            setLoading(false);
            return;
          }

          try {
            setLoading(true);
            const items = await api.listByUser(sellerId);
            if (!mounted) return;
            const itemsArray = asArray(items);
            setListings(itemsArray);
            setError(null);

            // Batch fetch cover images for first 24 listings
            if (itemsArray.length) {
              try {
                const ids = itemsArray.slice(0, 24).map(r => r.id);
                if (ids.length) {
                  const covers = await api.getCoversBatch(ids, { silent: true });
                  if (!mounted) return;
                  if (Array.isArray(covers) && covers.length) {
                    const patch = {};
                    covers.forEach(r => {
                      if (!r || r.id == null) return;
                      if (r.image_data) patch[r.id] = { url: r.image_data, thumb_url: r.thumb_url || null };
                    });
                    if (Object.keys(patch).length) {
                      setCoverById(prev => ({ ...prev, ...patch }));
                    }
                  }
                }
              } catch (coverErr) {
                console.warn('Failed to fetch cover images:', coverErr);
              }
            }
          } catch (err) {
            if (!mounted) return;
            console.error('Failed to fetch seller listings:', err);
            const message = (err && err.message) ? String(err.message) : '';
            if (message.toLowerCase().includes('not found')) {
              setError('User not found');
            } else {
              setError('Failed to load listings');
            }
            setListings([]);
          } finally {
            if (mounted) setLoading(false);
          }
        }

        fetchSellerListings();

        return () => { mounted = false; };
      }, [sellerId]);

      useEffect(() => {
        if (!selectedListing) return undefined;
        const onKey = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            setSelectedListing(null);
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [selectedListing]);

      useEffect(() => {
        setTab('active');
      }, [sellerId]);

      const ensureCover = useCallback(async (id) => {
        if (id == null) return;
        if (Object.prototype.hasOwnProperty.call(coverById, id)) return;
        try {
          const arr = await api.getListingImages(id, { silent: true });
          let obj = null;
          if (Array.isArray(arr) && arr.length) {
            obj = typeof arr[0] === 'string'
              ? { url: arr[0], w: null, h: null }
              : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
          }
          setCoverById((prev) => ({ ...prev, [id]: obj }));
        } catch {
          setCoverById((prev) => ({ ...prev, [id]: null }));
        }
      }, [coverById, api]);

      const activeListings = useMemo(
        () => listings.filter((item) => !item?.sold),
        [listings]
      );
      const soldListings = useMemo(
        () => listings.filter((item) => !!item?.sold),
        [listings]
      );
      const rawShownListings = tab === 'sold' ? soldListings : activeListings;

      const shownListings = useMemo(() => {
        return (rawShownListings || []).map(it => {
          const cached = coverById[it.id];
          const inline = cached?.url || selectPrimaryListingImage(it, it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null));
          const url = inline || '';
          const ar = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
          return { ...it, __cover: url, __ar: ar };
        });
      }, [rawShownListings, coverById]);

      const handleListingSelected = useCallback((item) => {
        if (!item) return;
        const cover = item.image_data || item.__cover || '';
        const inlineImages = collectListingImages(item, cover);
        const payload = { ...item };
        if (inlineImages.length) payload.images = inlineImages;
        if (cover) payload.image_data = cover;
        setSelectedListing(payload);
        if (item.id) {
          const cacheList = inlineImages.length ? inlineImages : null;
          if (cacheList && cacheList.length) {
            listingImageCache.set(item.id, cacheList);
          }
          fetchListingImagesCached(item.id).then((arr) => {
            if (Array.isArray(arr) && arr.length) {
              listingImageCache.set(item.id, arr);
            }
          }).catch(() => { });
        }
      }, []);

      const handleAdminDeleteInternal = useCallback((id) => {
        setListings((prev) => prev.filter((it) => it.id !== id));
        if (typeof onAdminDelete === 'function') {
          onAdminDelete(id);
        }
      }, [onAdminDelete]);

      const modalContent = selectedListing
        ? H('div', {
          className: 'modal open',
          onClick: (evt) => {
            if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
              setSelectedListing(null);
            }
          }
        },
          H('div', { className: 'modal-inner listing-modal' },
            H('button', { className: 'close', onClick: () => setSelectedListing(null) }, 'x'),
            H(ListingCard, {
              item: selectedListing,
              user,
              canEdit: false,
              onMessage: (listing) => {
                setSelectedListing(null);
                onMessage?.(listing);
              },
              onAdminDelete: (id) => {
                handleAdminDeleteInternal(id);
                setSelectedListing(null);
              },
              showDistance: false,
              onViewSeller: null,
              onSupporterClick,
              viewContext: 'modal'
            })
          )
        )
        : null;

      if (loading) {
        return H('div', { style: { padding: '24px', textAlign: 'center' } },
          H('div', { className: 'spinner' }),
          H('div', { style: { marginTop: '12px' } }, 'Loading seller profile...')
        );
      }

      if (error) {
        return H('div', { style: { padding: '24px', textAlign: 'center' } },
          H('div', { className: 'muted' }, error),
          H('button', { className: 'btn', onClick: onBack }, '<- Back')
        );
      }

      const isMobile = isMobileDevice();
      const gridColumns = isMobile ? 3 : 4;

      const sellerDisplayName = (sellerInfo && sellerInfo.username) || sellerUsername || '';
      const sellerLabel = sellerDisplayName || 'Seller';
      const sellerJoinedText = sellerInfo && sellerInfo.created_at ? formatElapsedSince(sellerInfo.created_at) : null;
      const sellerSupporterSince = sellerInfo?.supporter_since || null;
      const sellerSupporter = sellerInfo?.supporter_badge
        ? {
          username: sellerLabel,
          since: sellerSupporterSince,
          badge: sellerInfo.supporter_badge
        }
        : null;

      const sellerBgImageUrl = (sellerInfo && sellerInfo.profile_bg_image_url) || '';
      const trimmedSellerBgImageUrl = (sellerBgImageUrl || '').trim();
      const hasSellerBgImage = !!trimmedSellerBgImageUrl;
      const sellerAvatarBorderStyleValue = (sellerInfo?.profile_avatar_border_style === 'dashed') ? 'dashed' : 'solid';
      const sellerAvatarBorderColorValue = typeof sellerInfo?.profile_avatar_border_color === 'string' && sellerInfo.profile_avatar_border_color.trim()
        ? sellerInfo.profile_avatar_border_color.trim()
        : '#ffffff';

      // Stats pills style (matching user's own profile)
      const sellerStatPillStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        border: '1px solid rgba(148, 163, 184, 0.3)',
        background: 'rgba(248, 250, 252, 0.05)',
        fontSize: 13,
        color: '#f8fafc',
        fontWeight: 600
      };

      const sellerKarmaValue = typeof sellerInfo?.karma === 'number' ? sellerInfo.karma : 0;

      const sellerProfileHeaderContent = H('div', { style: { position: 'relative', minHeight: 180, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 12, alignItems: 'center', position: 'absolute', bottom: -6, left: -8 } },
          H('div', {
            style: {
              borderColor: sellerAvatarBorderColorValue,
              borderStyle: sellerAvatarBorderStyleValue,
              borderWidth: 4,
              width: 80,
              height: 80,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
              backgroundColor: '#f0f0f0',
              fontSize: 32,
              fontWeight: 800,
              color: '#666',
              boxShadow: '0 16px 35px rgba(2, 6, 23, 0.5)'
            }
          },
            (sellerInfo?.profile_picture_url && sellerInfo.profile_picture_url.trim())
              ? H('img', {
                src: sellerInfo.profile_picture_url,
                alt: 'Seller profile picture',
                style: { width: '100%', height: '100%', objectFit: 'cover' },
                onError: (e) => { e.target.style.display = 'none'; }
              })
              : (sellerLabel.charAt(0).toUpperCase())
          ),
          H('div', { style: { display: 'grid', gap: 6, alignItems: 'flex-start' } },
            H('div', { style: { fontWeight: 800, fontSize: 18 } }, sellerLabel),
            // Stats pills (active, sold, karma) - matching user's own profile
            H('div', {
              style: {
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 8
              }
            },
              // Active listings pill
              H('span', { style: sellerStatPillStyle }, '🛍️ ', activeListings.length, ' active'),
              // Sold pill
              H('span', { style: sellerStatPillStyle }, '✅ ', soldListings.length, ' sold'),
              // Karma pill (only for supporters with karma > 0)
              sellerSupporter && sellerKarmaValue > 0 && H('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(251, 191, 36, 0.4)',
                  background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.15))',
                  fontSize: 13,
                  color: '#fbbf24',
                  fontWeight: 600
                }
              },
                H('svg', {
                  viewBox: '0 0 24 24',
                  width: 14,
                  height: 14,
                  fill: 'currentColor',
                  style: { flexShrink: 0 }
                },
                  H('path', { d: 'M13 2L3 14h8l-1 8 10-12h-8l1-8z', fill: '#fbbf24' })
                ),
                ' ',
                sellerKarmaValue,
                ' karma'
              )
            )
          )
        )
      );

      // Default banner SVG for sellers without custom banner (matching user's own profile)
      const DefaultSellerBanner = () => H('svg', {
        viewBox: '0 0 800 220',
        preserveAspectRatio: 'xMidYMid slice',
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%'
        },
        'aria-hidden': 'true'
      },
        H('defs', null,
          H('linearGradient', { id: 'sellerBannerBg', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#0f172a' }),
            H('stop', { offset: '50%', stopColor: '#1e293b' }),
            H('stop', { offset: '100%', stopColor: '#0f172a' })
          ),
          H('linearGradient', { id: 'sellerBannerAccent', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
            H('stop', { offset: '0%', stopColor: '#3b82f6', stopOpacity: '0.3' }),
            H('stop', { offset: '50%', stopColor: '#8b5cf6', stopOpacity: '0.4' }),
            H('stop', { offset: '100%', stopColor: '#3b82f6', stopOpacity: '0.3' })
          ),
          H('linearGradient', { id: 'sellerTextGradient', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
            H('stop', { offset: '0%', stopColor: '#60a5fa' }),
            H('stop', { offset: '50%', stopColor: '#a78bfa' }),
            H('stop', { offset: '100%', stopColor: '#60a5fa' })
          ),
          H('filter', { id: 'sellerGlow' },
            H('feGaussianBlur', { stdDeviation: '3', result: 'coloredBlur' }),
            H('feMerge', null,
              H('feMergeNode', { in: 'coloredBlur' }),
              H('feMergeNode', { in: 'SourceGraphic' })
            )
          ),
          H('pattern', { id: 'sellerDots', x: '0', y: '0', width: '20', height: '20', patternUnits: 'userSpaceOnUse' },
            H('circle', { cx: '2', cy: '2', r: '1', fill: 'rgba(148, 163, 184, 0.08)' })
          )
        ),
        H('rect', { x: '0', y: '0', width: '800', height: '220', fill: 'url(#sellerBannerBg)' }),
        H('rect', { x: '0', y: '0', width: '800', height: '220', fill: 'url(#sellerDots)' }),
        H('rect', { x: '0', y: '60', width: '800', height: '100', fill: 'url(#sellerBannerAccent)' }),
        H('circle', { cx: '650', cy: '110', r: '120', fill: 'none', stroke: 'rgba(99, 102, 241, 0.15)', strokeWidth: '1' }),
        H('circle', { cx: '680', cy: '90', r: '80', fill: 'none', stroke: 'rgba(139, 92, 246, 0.12)', strokeWidth: '1' }),
        H('circle', { cx: '100', cy: '150', r: '100', fill: 'none', stroke: 'rgba(59, 130, 246, 0.1)', strokeWidth: '1' }),
        H('g', { transform: 'translate(720, 30)', opacity: '0.15' },
          H('path', {
            d: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z',
            fill: '#60a5fa',
            transform: 'scale(1.5)'
          })
        ),
        H('text', {
          x: '760',
          y: '195',
          textAnchor: 'end',
          style: {
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '28px',
            fontWeight: '700',
            letterSpacing: '2px'
          },
          fill: 'url(#sellerTextGradient)',
          filter: 'url(#sellerGlow)',
          opacity: '0.6'
        }, 'trovelr')
      );

      const sellerProfileHeader = H('div', {
        style: {
          position: 'relative',
          height: 220,
          overflow: 'hidden'
        }
      },
        // Show custom banner if uploaded, otherwise show default trovelr banner
        hasSellerBgImage
          ? H('img', {
            key: trimmedSellerBgImageUrl,
            src: trimmedSellerBgImageUrl,
            alt: 'Seller profile banner',
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
          : H(DefaultSellerBanner),
        // Gradient overlay (stronger for custom images, subtle for default)
        H('div', {
          style: {
            position: 'absolute',
            inset: 0,
            background: hasSellerBgImage
              ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.15) 0%, rgba(15, 23, 42, 0.92) 100%)'
              : 'linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.7) 100%)'
          }
        }),
        H('div', {
          style: {
            position: 'relative',
            padding: '16px 16px 60px',
            color: '#f8fafc'
          }
        }, sellerProfileHeaderContent)
      );

      return H(React.Fragment, null,
        H('section', { className: 'card', style: { padding: 0, margin: '12px 0 16px', overflow: 'hidden', background: '#020617', color: '#f8fafc' } },
          sellerProfileHeader
        ),

        // Row with supporter badge, join date on left, and buttons on right (matching user's own profile)
        H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 16px', justifyContent: 'space-between' } },
          // Left side: Supporter badge and join date
          H('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            sellerSupporter && H(SupporterBadge, {
              size: 'sm',
              since: sellerSupporter.since,
              tier: sellerSupporter.tier,
              onClick: () => onSupporterClick?.(sellerSupporter)
            }),
            sellerJoinedText && H('div', { className: 'muted', style: { fontSize: 13 } }, `Trovelr since ${sellerJoinedText}`)
          ),
          // Right side: Back button
          H('button', { className: 'btn', onClick: onBack, style: { padding: '8px 16px', fontSize: 14 } }, '← Back')
        ),

        H('div', { className: 'row', style: { gap: 8, margin: '0 0 16px' } },
          H('button', {
            className: `btn ${tab === 'active' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setTab('active')
          }, 'Active listings'),
          H('button', {
            className: `btn ${tab === 'sold' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setTab('sold')
          }, 'Sold listings')
        ),

        shownListings.length === 0
          ? H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } },
            tab === 'sold' ? 'No sold listings yet.' : 'No listings from this seller.')
          : (ListingsGrid
            ? H(ListingsGrid, {
              items: shownListings,
              onEnsureCover: ensureCover,
              onSelect: (evt, item) => handleListingSelected(item),
              onSupporterClick,
              columns: gridColumns
            })
            : H('div', { style: { padding: 16, textAlign: 'center' } }, 'Grid component not available')
          ),

        modalContent
      );
    }

    return {
      MultiFilePicker,
      InfoHelpModal,
      AutoListHelpModal,
      ListingForm,
      MassListModal,
      ReportSellerModal,
      ListingModal,
      ListingCard,
      ListingGalleryModal,
      SellerProfile
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.listings = {
    createListingComponents
  };
})();
