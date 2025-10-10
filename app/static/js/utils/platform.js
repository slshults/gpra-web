// Platform Detection Utility
// Detects user's platform and determines feature availability

/**
 * Detect the user's operating system
 * @returns {string} Operating system name
 */
export const detectOS = () => {
  if (typeof window === 'undefined') return 'unknown';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('android')) return 'android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod')) return 'ios';
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('linux')) return 'linux';

  return 'unknown';
};

/**
 * Check if the current platform is mobile
 * @returns {boolean} True if mobile platform
 */
export const isMobile = () => {
  const os = detectOS();
  return os === 'android' || os === 'ios';
};

/**
 * Check if songbook folder features should be available
 * @returns {boolean} True if folder opening is supported
 */
export const supportsFolderOpening = () => {
  const os = detectOS();
  return ['windows', 'macos', 'linux'].includes(os);
};

/**
 * Get a user-friendly platform name
 * @returns {string} Platform display name
 */
export const getPlatformDisplayName = () => {
  const os = detectOS();
  const displayNames = {
    'android': 'Android',
    'ios': 'iOS',
    'macos': 'macOS',
    'windows': 'Windows',
    'linux': 'Linux',
    'unknown': 'Unknown'
  };
  return displayNames[os] || 'Unknown';
};

/**
 * Check if we're running on mobile using additional checks
 * @returns {boolean} True if mobile device detected
 */
export const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;

  // Check multiple indicators for mobile
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;

  return isMobileUA || (isTouchDevice && isSmallScreen);
};

export default {
  detectOS,
  isMobile,
  supportsFolderOpening,
  getPlatformDisplayName,
  isMobileDevice
};