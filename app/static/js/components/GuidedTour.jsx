import { useEffect } from 'react';
import { driver } from 'driver.js';
import { useNavigation } from '@contexts/NavigationContext';

// Check if we're on mobile at tour start (uses matchMedia for DevTools compatibility)
const isMobileView = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

// Helper to get the right image path based on device
const getTourImage = (desktopGif, mobilePng, desktopSize, mobileAlt) => {
  const mobile = isMobileView();
  if (mobile) {
    // No images on mobile - text only for better UX
    return '';
  } else if (desktopGif) {
    // Desktop: fixed size GIF
    return `<div style="text-align: center;"><img src="/static/images/tour/${desktopGif}" style="width: ${desktopSize.width}px; height: ${desktopSize.height}px; border-radius: 4px;" alt="${mobileAlt || 'Tour step'}"></div>`;
  }
  return '';
};

const GuidedTour = () => {
  const { setActivePage } = useNavigation();

  useEffect(() => {
    // Check if tour should be shown
    const checkTourStatus = async () => {
      try {
        console.log('[TOUR] Checking tour status...');
        const response = await fetch('/api/user/preferences/tour-status');
        console.log('[TOUR] API response status:', response.status);
        if (!response.ok) {
          console.log('[TOUR] API response not OK, aborting');
          return;
        }

        const data = await response.json();
        console.log('[TOUR] API data:', data);

        // Check if we should show the tour
        // Either from tour status API, URL param, or sessionStorage flag after registration
        const urlParams = new URLSearchParams(window.location.search);
        const showTourParam = urlParams.has('show_tour');
        const showTourAfterLogin = sessionStorage.getItem('show_tour_after_login') === 'true';

        console.log('[TOUR] showTourParam:', showTourParam);
        console.log('[TOUR] showTourAfterLogin:', showTourAfterLogin);
        console.log('[TOUR] data.show_tour:', data.show_tour);

        if (data.show_tour || showTourParam || showTourAfterLogin) {
          console.log('[TOUR] Starting tour!');
          // Clear sessionStorage flag
          if (showTourAfterLogin) {
            sessionStorage.removeItem('show_tour_after_login');
          }

          // Remove the URL param if present
          if (showTourParam) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
          }

          // Start tour after a short delay to let the page settle
          setTimeout(() => startTour(), 500);
        }
      } catch (error) {
        console.error('Error checking tour status:', error);
      }
    };

    checkTourStatus();
  }, []);

  const markTourComplete = async () => {
    try {
      await fetch('/api/user/preferences/tour-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error marking tour complete:', error);
    }
  };

  const startTour = () => {
    const driverObj = driver({
      showProgress: true,
      showButtons: ['next', 'previous'],
      popoverClass: 'gpra-tour-popover',
      overlayOpacity: 0.55,
      stagePadding: 15,
      stageRadius: 8,
      allowClose: false,
      smoothScroll: true,
      steps: [
        {
          element: '[data-tour="app-title"]',
          popover: {
            title: 'Welcome to Guitar Practice Routine App!',
            description: 'You\'ll be tempted to skip through this tour without reading it, but since you\'re new here you\'ll get a lot more from the app (a lot more quickly) if you take the tour.<br><br> Click `Next` to get going... 🎸<br><br><strong>Sidenote:</strong> The app works on mobile, but it\'s best on desktop/laptop ',
            popoverClass: 'gpra-tour-popover gpra-tour-welcome',
            side: 'bottom',
            align: 'start'
          }
        },
        {
          element: '[data-tour="items-tab"]',
          onHighlightStarted: (element) => {
            // Wait for layout to settle and images to load before positioning
            return new Promise((resolve) => {
              // Force layout recalculation
              element.getBoundingClientRect();

              // Wait for any images in popovers to load
              const images = document.querySelectorAll('.driver-popover img');
              if (images.length > 0) {
                let loadedCount = 0;
                const checkAllLoaded = () => {
                  loadedCount++;
                  if (loadedCount === images.length) {
                    // All images loaded, wait a bit more for layout to settle
                    setTimeout(resolve, 100);
                  }
                };

                images.forEach(img => {
                  if (img.complete) {
                    checkAllLoaded();
                  } else {
                    img.addEventListener('load', checkAllLoaded);
                    img.addEventListener('error', checkAllLoaded); // Resolve even on error
                  }
                });
              } else {
                // No images, just wait for layout to settle
                setTimeout(resolve, 100);
              }
            });
          },
          popover: {
            title: 'Step 1: Creating practice items',
            description: `Use the items page to create and manage items.<br>Items can be songs, exercises, reminders, etc.<br>${getTourImage('CreateItem.gif', 'mobile-items-add.png', { width: 600, height: 579 }, 'Creating a practice item')}`,
            side: 'bottom',
            align: 'start',
            onNextClick: () => {
              // Navigate to Routines BEFORE Step 2 initializes
              setActivePage('Routines');
              // Wait longer for navigation to complete
              setTimeout(() => {
                driverObj.moveNext();
              }, 400);
              // Prevent default advancement
              return false;
            }
          }
        },
        {
          element: '[data-tour="new-routine-input"]',
          onHighlightStarted: (element) => {
            // Wait for layout to settle and images to load before positioning
            return new Promise((resolve) => {
              // Force layout recalculation
              element.getBoundingClientRect();

              // Wait for any images in popovers to load
              const images = document.querySelectorAll('.driver-popover img');
              if (images.length > 0) {
                let loadedCount = 0;
                const checkAllLoaded = () => {
                  loadedCount++;
                  if (loadedCount === images.length) {
                    // All images loaded, wait a bit more for layout to settle
                    setTimeout(resolve, 100);
                  }
                };

                images.forEach(img => {
                  if (img.complete) {
                    checkAllLoaded();
                  } else {
                    img.addEventListener('load', checkAllLoaded);
                    img.addEventListener('error', checkAllLoaded); // Resolve even on error
                  }
                });
              } else {
                // No images, just wait for layout to settle
                setTimeout(resolve, 100);
              }
            });
          },
          popover: {
            title: 'Step 2: Creating routines',
            description: `Routines are for organizing your practice items into structured sessions.<br><br>Enter a name for a new routine, then click the \`+ Add\` button.<br><br>${getTourImage('CreateRoutine.gif', 'mobile-routines-create.png', { width: 600, height: 495 }, 'Creating a routine')}`,
            side: 'bottom',
            align: 'start',
            onPrevClick: () => {
              // Navigate back to Items page when going backwards
              setActivePage('Items');
              // Wait for navigation, then manually go back
              setTimeout(() => {
                driverObj.movePrevious();
              }, 400);
              // Prevent default behavior
              return false;
            },
            onPopoverRender: () => {
              // Scroll element into view after popover renders
              setTimeout(() => {
                const element = document.querySelector('[data-tour="new-routine-input"]');
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
            },
            onNextClick: () => {
              // Stay on Routines - Step 3 needs it too, just advance normally
              driverObj.moveNext();
              return false;
            }
          }
        },
        {
          element: '[data-tour="edit-routine-icon"]',
          onHighlightStarted: () => {
            // Scroll to top on mobile so the edit icon is visible
            window.scrollTo({ top: 0, behavior: 'smooth' });
            // Small delay to let scroll complete before highlight positions
            return new Promise((resolve) => setTimeout(resolve, 150));
          },
          popover: {
            title: 'Step 3: Adding items to routines',
            description: `To add items to routines, click the ✏️ edit icon.<br><br>Drag n' drop to reorder!<br><br>${getTourImage('AddItemsToRoutine.gif', 'mobile-routine-edit.png', { width: 600, height: 435 }, 'Adding items to routine')}`,
            side: 'left',
            align: 'start',
            onNextClick: () => {
              // Navigate to Practice BEFORE Step 4 initializes
              setActivePage('Practice');
              // Wait for navigation, then manually advance
              setTimeout(() => {
                driverObj.moveNext();
              }, 200);
              return false;
            }
          }
        },
        {
          element: '[data-tour="practice-tab"]',
          popover: {
            title: 'Step 4: Practice page',
            description: 'This is where you\'ll spend your time when you\'re practicing. The Practice page shows the active routine and its items.<br><br> To change the active routine, go to the Routines page and click the `+` on a routine to make it active.',
            side: 'bottom',
            align: 'start',
            onPrevClick: () => {
              // Navigate back to Routines page when going backwards
              setActivePage('Routines');
              // Wait for navigation, then manually go back
              setTimeout(() => {
                driverObj.movePrevious();
              }, 200);
              // Prevent default behavior
              return false;
            },
            onNextClick: () => {
              // Expand sections BEFORE moving to Step 5
              const firstItemHeader = document.querySelector('[data-item-header]');
              if (firstItemHeader && firstItemHeader.getAttribute('data-expanded') !== 'true') {
                firstItemHeader.click();
              }

              setTimeout(() => {
                const chordChartsSection = document.querySelector('[data-tour="chord-charts"]');
                if (chordChartsSection) {
                  const chordChartsButton = chordChartsSection.closest('.cursor-pointer');
                  if (chordChartsButton) {
                    const chevron = chordChartsButton.querySelector('svg');
                    if (chevron && !chevron.classList.contains('rotate-0')) {
                      chordChartsButton.click();
                    }
                  }
                }

                // Wait for expansions to complete, then move to Step 5
                setTimeout(() => {
                  driverObj.moveNext();
                }, 500);
              }, 400);

              return false;
            }
          }
        },
        {
          element: '[data-tour="chord-charts-section"]',
          onHighlighted: (element) => {
            // After Driver.js positions, scroll so element appears BELOW the popover
            // The popover is CSS-positioned at top: 10%, so we scroll the element
            // to appear in the lower half of the viewport
            setTimeout(() => {
              const rect = element.getBoundingClientRect();
              const viewportHeight = window.innerHeight;
              // Target: element at ~55% from top of viewport (below the popover)
              const targetY = viewportHeight * 0.55;
              const scrollY = window.scrollY + rect.top - targetY;
              window.scrollTo({ top: Math.max(0, scrollY), behavior: 'smooth' });
            }, 150);
          },
          popover: {
            title: 'Step 5: Chord charts',
            description: 'You can view and manage chord charts from the `Practice`, `Routines`, and `Items` pages. You can create charts manually, or use the autocreate feature to build charts from PDFs, images, YouTube lesson videos, or type the names of the song sections and chords.',
            side: 'top',
            align: 'center',
            popoverClass: 'gpra-tour-popover gpra-tour-chord-charts',
            onPrevClick: () => {
              // Navigate back to Practice tab highlight when going backwards
              setActivePage('Practice');
              // Wait for navigation, then manually go back
              setTimeout(() => {
                driverObj.movePrevious();
              }, 200);
              // Prevent default behavior
              return false;
            },
            onNextClick: () => {
              // Navigate to Account BEFORE Step 6 initializes
              setActivePage('Account');
              // Wait for navigation, then expand API key card, then advance
              setTimeout(() => {
                // Check if the API key input is visible (card expanded)
                const apiKeyInput = document.querySelector('[data-tour="api-key-input"]');
                if (!apiKeyInput) {
                  // Card is collapsed, click header to expand
                  const apiKeyCardHeader = document.querySelector('[data-tour="api-key-card-header"]');
                  if (apiKeyCardHeader) {
                    apiKeyCardHeader.click();
                  }
                }
                // Wait for card expansion animation, then advance
                setTimeout(() => {
                  driverObj.moveNext();
                }, 300);
              }, 400);
              return false;
            }
          }
        },
        {
          element: '[data-tour="api-key-input"]',
          onHighlighted: (element) => {
            // After Driver.js positions, scroll to show element with title above it
            setTimeout(() => {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          },
          popover: {
            title: 'Step 6: Adding your API key',
            description: 'To use the autocreate feature on free and basic tiers, add your Anthropic API key on the account page. Then Claude can build chord charts for you.',
            side: 'bottom',
            align: 'start',
            popoverClass: 'gpra-tour-popover gpra-tour-api-key',
            onPrevClick: () => {
              // Navigate back to Practice page when going backwards
              setActivePage('Practice');
              // Wait for navigation, then manually go back
              setTimeout(() => {
                driverObj.movePrevious();
              }, 200);
              // Prevent default behavior
              return false;
            }
          }
        },
        {
          element: '[data-tour="items-tab"]',
          popover: {
            title: 'You\'re all set!',
            description: 'That\'s it for the tour. Rock on! 🤘<br> (or blues on, folk on, jazz on, hip hop on, country on, reggae on, get your worship on, or whatever floats your musical boat...)',
            popoverClass: 'gpra-tour-popover gpra-tour-welcome',
            side: 'bottom',
            align: 'start'
          }
        }
      ],
      onDestroyed: () => {
        // Navigate to Items page after tour completion
        setActivePage('Items');
        // Scroll to top after navigation
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 200);
        // Mark tour as complete when naturally finished
        markTourComplete();
      }
    });

    driverObj.drive();
  };

  return null;
};

export default GuidedTour;
