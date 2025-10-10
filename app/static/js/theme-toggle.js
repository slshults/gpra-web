// Simple Light Mode Toggle
// Keep dark mode as default, light mode as optional

function initThemeToggle() {
  // Check localStorage for saved preference (defaults to dark mode)
  const isLightMode = localStorage.getItem('lightMode') === 'true';

  // Apply saved theme
  if (isLightMode) {
    document.body.classList.add('light-mode');
  }

  // Update toggle button visibility based on current mode
  updateToggleDisplay(isLightMode);
}

function toggleTheme() {
  const isCurrentlyLight = document.body.classList.contains('light-mode');

  if (isCurrentlyLight) {
    // Switch to dark mode (default)
    document.body.classList.remove('light-mode');
    localStorage.setItem('lightMode', 'false');
  } else {
    // Switch to light mode
    document.body.classList.add('light-mode');
    localStorage.setItem('lightMode', 'true');
  }

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