import { useEffect } from 'react';
import { driver } from 'driver.js';
import { useNavigation } from '@contexts/NavigationContext';
import { debugLog } from '@utils/logging';

// Check if we're on mobile at tour start (uses matchMedia for DevTools compatibility)
const isMobileView = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

// Helper to get the right image path based on device
const getTourImage = (desktopGif, mobilePng, desktopSize, mobileAlt) => {
  const mobile = isMobileView();
  if (mobile) {
    // No images on mobile - text only for better UX
    return '';
  } else if (desktopGif) {
    // Desktop: fixed size autoplaying video (MP4 replaces the old GIF to cut payload)
    const desktopMp4 = desktopGif.replace(/\.gif$/, '.mp4');
    return `<div style="text-align: center;"><video src="/static/images/tour/${desktopMp4}" autoplay loop muted playsinline style="width: ${desktopSize.width}px; height: ${desktopSize.height}px; border-radius: 4px;" aria-label="${mobileAlt || 'Tour step'}"></video></div>`;
  }
  return '';
};

// Flush layout, then settle briefly so Driver.js positions the popover against a
// stable box. Popover media is now fixed-size <video> (no load event to wait on),
// and `element` can be undefined if Driver.js highlights a missing target.
const settleLayout = (element) =>
  new Promise((resolve) => {
    element?.getBoundingClientRect();
    setTimeout(resolve, 100);
  });

// Steps that follow a page change used to advance on a fixed timeout, which is a
// race: a page that is still fetching (Routines shows "Loading routines...")
// renders no target yet, and Driver.js then highlights nothing. Poll for the
// target instead, and fall through after `timeout` so a genuinely missing
// element can't strand the tour.
const waitForElement = (selector, timeout = 3000) =>
  new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      const el = document.querySelector(selector);
      if (el || Date.now() - started >= timeout) {
        resolve(el);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });

// `suppressed` is set for the page load that comes back from Stripe Checkout. The
// tour must not hijack the moment right after someone pays.
const GuidedTour = ({ suppressed = false }) => {
  const { setActivePage } = useNavigation();

  useEffect(() => {
    if (suppressed) {
      debugLog('TOUR', 'Suppressed for this page load (returning from Stripe checkout)');
      return;
    }

    // Check if tour should be shown
    const checkTourStatus = async () => {
      try {
        debugLog('TOUR', 'Checking tour status...');
        const response = await fetch('/api/user/preferences/tour-status');
        debugLog('TOUR', 'API response status:', response.status);
        if (!response.ok) {
          debugLog('TOUR', 'API response not OK, aborting');
          return;
        }

        const data = await response.json();
        debugLog('TOUR', 'API data:', data);

        // Check if we should show the tour
        // Either from tour status API, URL param, or sessionStorage flag after registration
        const urlParams = new URLSearchParams(window.location.search);
        const showTourParam = urlParams.has('show_tour');
        const showTourAfterLogin = sessionStorage.getItem('show_tour_after_login') === 'true';

        debugLog('TOUR', 'showTourParam:', showTourParam);
        debugLog('TOUR', 'showTourAfterLogin:', showTourAfterLogin);
        debugLog('TOUR', 'data.show_tour:', data.show_tour);

        if (data.show_tour || showTourParam || showTourAfterLogin) {
          debugLog('TOUR', 'Starting tour!');
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

    // Insurance: if this unmounts mid-tour, don't strand the body class and
    // leave the support widget hidden for the rest of the session.
    return () => document.body.classList.remove('gpra-tour-active');
  }, [suppressed]);

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
    // Record the tour as seen up front. `onDestroyed` only fires when the tour runs
    // all the way to its last step, so an abandoned tour used to leave show_tour
    // true and relaunch on every later full page load. Account settings still has
    // a "Restart tour" button for anyone who wants another pass.
    markTourComplete();

    // The PostHog conversations bubble floats over the tour popovers and the
    // elements they highlight, so it stays hidden until the tour is done.
    document.body.classList.add('gpra-tour-active');

    // Steps that wait on an element before advancing leave a window where a
    // second Next tap arrives mid-wait; without this the extra tap is swallowed
    // and the button looks dead until you tap again.
    let advancing = false;
    const advanceAfter = (work) => {
      if (advancing) return false;
      advancing = true;
      Promise.resolve(work()).then(() => {
        advancing = false;
        driverObj.moveNext();
      });
      return false;
    };

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
          onHighlightStarted: settleLayout,
          popover: {
            title: 'Step 1: Creating practice items',
            description: `Use the items page to create and manage items.<br>Items can be songs, exercises, reminders, etc.<br>${getTourImage('CreateItem.gif', 'mobile-items-add.png', { width: 600, height: 579 }, 'Creating a practice item')}`,
            side: 'bottom',
            align: 'start',
            onNextClick: () =>
              // Navigate to Routines BEFORE Step 2 initializes, and wait for the
              // "+ New" button to actually exist — RoutinesPage renders a loading
              // state while it fetches, and advancing into that left Step 2 with
              // nothing to highlight (most visible on mobile).
              advanceAfter(() => {
                setActivePage('Routines');
                return waitForElement('[data-tour="new-routine-input"]');
              })
          }
        },
        {
          element: '[data-tour="new-routine-input"]',
          onHighlightStarted: settleLayout,
          popover: {
            title: 'Step 2: Creating routines',
            description: `Routines are for organizing your practice items into structured sessions.<br><br>Enter a name for a new routine, then click the \`+ Add\` button.<br><br>${getTourImage('CreateRoutine.gif', 'mobile-routines-create.png', { width: 600, height: 495 }, 'Creating a routine')}`,
            side: 'bottom',
            align: 'start',
            onPrevClick: () => {
              // Navigate back to Items page when going backwards, waiting for
              // the tab to exist rather than guessing at a delay
              setActivePage('Items');
              waitForElement('[data-tour="items-tab"]').then(() => {
                driverObj.movePrevious();
              });
              // Prevent default behavior
              return false;
            },
            onPopoverRender: () => {
              // Scroll element into view after popover renders. On mobile the
              // button lives in a sticky top bar: scrolling it to centre moves
              // the page while the button stays pinned, which drags the
              // highlight off it. Going to the top keeps the two together.
              setTimeout(() => {
                if (isMobileView()) {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  return;
                }
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
              // Expand sections BEFORE moving to Step 5. Desktop rows report
              // state via data-expanded, mobile rows via aria-expanded — check
              // both, or on mobile this reads null and clicks an already-open
              // item shut (now likely, since Practice restores expanded items).
              const firstItemHeader = document.querySelector('[data-item-header]');
              const alreadyOpen = firstItemHeader?.getAttribute('data-expanded') === 'true'
                || firstItemHeader?.getAttribute('aria-expanded') === 'true';
              if (firstItemHeader && !alreadyOpen) {
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
            // `element` can be undefined if Driver.js highlights a missing target
            if (!element) return;
            // After Driver.js positions, scroll the element clear of the popover.
            // Desktop keeps the popover at top: 10%, so the element goes below
            // it. Mobile pins the popover to the bottom half (driver-theme.css)
            // because it was covering the demo routine, so there the element
            // goes above it instead.
            setTimeout(() => {
              const rect = element.getBoundingClientRect();
              const viewportHeight = window.innerHeight;
              const targetY = viewportHeight * (isMobileView() ? 0.2 : 0.55);
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
            // `element` can be undefined if Driver.js highlights a missing target
            if (!element) return;
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
          // Points at Practice because that's where Done now lands
          element: '[data-tour="practice-tab"]',
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
        document.body.classList.remove('gpra-tour-active');
        // Land on Practice: it's where a new user actually starts, and the demo
        // routine is already waiting there.
        setActivePage('Practice');
        // Scroll to top after navigation
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 200);
      }
    });

    driverObj.drive();
  };

  return null;
};

export default GuidedTour;
