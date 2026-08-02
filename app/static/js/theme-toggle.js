// Simple Light Mode Toggle
// Keep dark mode as default, light mode as optional

// Apply the theme to BOTH <html> and <body>.
//
// The anti-flash script inlined in each standalone page's <head> sets
// light-mode on <html> before paint, but this file used to add and remove it
// only on <body>. The stylesheet keys off descendant selectors
// (.light-mode .text-gray-300, .light-mode .bg-gray-800, ~60 of them), so a
// light-mode class left behind on <html> keeps matching every element in the
// body: toggling to dark gave dark backgrounds with light-mode text on top.
// Only reproducible after a reload in light mode, which is why it survived -
// toggling light and back in a single page view never left the class behind.
const applyTheme = (isLightMode) => {
  document.documentElement.classList.toggle('light-mode', isLightMode);
  document.body.classList.toggle('light-mode', isLightMode);
  document.documentElement.classList.toggle('dark', !isLightMode);
};

function initThemeToggle() {
  // Check localStorage for saved preference (defaults to dark mode)
  const isLightMode = localStorage.getItem('lightMode') === 'true';

  applyTheme(isLightMode);

  // Update toggle button visibility based on current mode
  updateToggleDisplay(isLightMode);
}

function toggleTheme() {
  // Read from <html>: the anti-flash script sets it there before <body> exists,
  // and applyTheme keeps the two in sync from then on
  const isCurrentlyLight = document.documentElement.classList.contains('light-mode');

  applyTheme(!isCurrentlyLight);
  localStorage.setItem('lightMode', String(!isCurrentlyLight));

  updateToggleDisplay(!isCurrentlyLight);
}

function updateToggleDisplay(isLightMode) {
  const lightModeToggle = document.getElementById('light-mode-toggle');
  const darkModeToggle = document.getElementById('dark-mode-toggle');

  if (lightModeToggle && darkModeToggle) {
    if (isLightMode) {
      // Currently in light mode, show dark mode toggle (to switch back)
      lightModeToggle.style.display = 'none';
      darkModeToggle.style.display = 'block';
    } else {
      // Currently in dark mode, show light mode toggle
      lightModeToggle.style.display = 'block';
      darkModeToggle.style.display = 'none';
    }
  }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', initThemeToggle);

// Attach toggle function to global scope
window.toggleTheme = toggleTheme;