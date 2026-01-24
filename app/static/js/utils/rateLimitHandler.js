// Rate limit (429) error handling with toast notifications
// This module intercepts fetch responses and shows user-friendly messages for rate limiting

let toastTimeout = null;
let isToastVisible = false;
const TOAST_DURATION = 5000; // 5 seconds

// Show a toast notification for rate limiting
function showRateLimitToast() {
  if (isToastVisible) return; // Don't stack toasts

  isToastVisible = true;

  // Remove any existing toast
  hideRateLimitToast();

  const toast = document.createElement('div');
  toast.id = 'rate-limit-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #f59e0b;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    max-width: 350px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideIn 0.3s ease-out;
  `;

  // Add animation keyframes if not already present
  if (!document.getElementById('rate-limit-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'rate-limit-toast-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    <div>
      <div style="font-weight: 600;">Slow down there, speedy</div>
      <div style="font-size: 12px; opacity: 0.9;">Too many requests - please wait a moment</div>
    </div>
  `;

  document.body.appendChild(toast);

  // Auto-hide after duration
  toastTimeout = setTimeout(() => {
    const existingToast = document.getElementById('rate-limit-toast');
    if (existingToast) {
      existingToast.style.animation = 'slideOut 0.3s ease-out forwards';
      setTimeout(() => {
        hideRateLimitToast();
        isToastVisible = false;
      }, 300);
    }
  }, TOAST_DURATION);
}

function hideRateLimitToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  const existingToast = document.getElementById('rate-limit-toast');
  if (existingToast) {
    existingToast.remove();
  }
}

// Wrap the native fetch to intercept 429 responses
const originalFetch = window.fetch;

window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);

  // Check for rate limiting (429 status)
  if (response.status === 429) {
    showRateLimitToast();
  }

  return response;
};

// Export for direct use if needed
export { showRateLimitToast, hideRateLimitToast };
