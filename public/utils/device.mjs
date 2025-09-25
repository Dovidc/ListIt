export function isMobileDevice() {
  const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase();

  if (/(iphone|ipod|ipad|android|windows phone|iemobile|mobile)/.test(ua)) {
    return true;
  }

  if (/macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
    return true;
  }

  return false;
}
