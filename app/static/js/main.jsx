// app/static/js/main.jsx
import '../css/input.css'
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { NavigationProvider, useNavigation } from '@contexts/NavigationContext';
import { PracticeItemsList } from '@components/PracticeItemsList';
import { PracticePage } from '@components/PracticePage';
import NavMenu from '@components/NavMenu';
import RoutinesPage from '@components/RoutinesPage';
import ImportsPage from '@components/ImportsPage';
import AccountSettings from '@components/AccountSettings';
import GuidedTour from '@components/GuidedTour';
import LapsedSubscriptionModal from '@components/LapsedSubscriptionModal';
import UnpluggedAccessModal from '@components/UnpluggedAccessModal';
import CookieConsent from '@components/CookieConsent';
import DeletionBanner from '@components/DeletionBanner';
import ImpersonationBanner from '@components/ImpersonationBanner';
import KofiWidget from '@components/KofiWidget';
import AutocreateWatcher from '@components/AutocreateWatcher';
import StatsPage from '@components/StatsPage';
import ErrorBoundary from '@components/ErrorBoundary';
import MobileTabBar, { TAB_BAR_HEIGHT } from '@components/MobileTabBar';
import { useLightweightItems } from '@hooks/useLightweightItems';
import { useIsMobile } from '@hooks/useIsMobile';
import { setUserContext } from './utils/analytics';
import { isCheckoutReturn, getCheckoutSessionId, clearCheckoutParams } from '@utils/checkoutReturn';
import { Loader2 } from 'lucide-react';

// Initialize rate limit handling (intercepts fetch for 429 errors)
import './utils/rateLimitHandler';

const ItemsPage = () => {
  const { items, refreshItems } = useLightweightItems();
  return <PracticeItemsList items={items} onItemsChange={refreshItems} />;
};

const PageContent = ({ userStatus }) => {
  const { activePage } = useNavigation();

  switch (activePage) {
    case 'Practice':
      return <PracticePage />;
    case 'Routines':
      return <RoutinesPage />;
    case 'Items':
      return <ItemsPage />;
    case 'Stats':
      return <StatsPage userStatus={userStatus} />;
    case 'Imports':
      return <ImportsPage />;
    case 'Account':
      return <AccountSettings />;
    case 'FAQ':
      // Redirect to static FAQ page
      window.location.href = '/faq';
      return null;
    default:
      return <div>Page not implemented yet</div>;
  }
};

const IMPERSONATION_BANNER_HEIGHT = 36; // px - matches py-2 + text-sm single line

// Read at import time, before the checkout params get cleared from the URL
const CHECKOUT_RETURN = { came: isCheckoutReturn(), sessionId: getCheckoutSessionId() };

const App = () => {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const [showLapsedModal, setShowLapsedModal] = useState(false);
  const [lapsedInfo, setLapsedInfo] = useState({});
  const [userStatus, setUserStatus] = useState(null);
  const { activePage, setActivePage } = useNavigation();
  const [showUnpluggedModal, setShowUnpluggedModal] = useState(false);
  const [unpluggedTarget, setUnpluggedTarget] = useState('');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  // Hold the app back while a checkout return is reconciled, so no child mounts and
  // reads /api/auth/status before the tier the user just paid for is in the database.
  const [syncingUpgrade, setSyncingUpgrade] = useState(CHECKOUT_RETURN.sessionId !== null);

  const isImpersonating = userStatus?.impersonating === true;
  const bannerOffset = isImpersonating ? IMPERSONATION_BANNER_HEIGHT : 0;
  const isMobile = useIsMobile();
  // Reserve room for the fixed bottom tab bar on mobile so page content can
  // scroll clear of it
  const bottomNavPadding = isMobile ? TAB_BAR_HEIGHT + 8 : 0;
  // Pages whose mobile view renders its own 52px top bar: hide the fixed app
  // header and go full-bleed (the mobile view manages its own padding)
  const mobileFullBleed = isMobile && ['Practice', 'Routines', 'Items', 'Stats'].includes(activePage);

  useEffect(() => {
    const updateHeaderHeight = () => {
      // Only measure when the header is actually visible — on mobileFullBleed
      // pages it's hidden (offsetHeight 0), and we must not let that corrupt
      // the height used to pad other pages.
      if (headerRef.current && headerRef.current.offsetHeight > 0) {
        const height = headerRef.current.offsetHeight;
        setHeaderHeight(height + 20); // Add 20px buffer
      }
    };

    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    return () => window.removeEventListener('resize', updateHeaderHeight);
    // Re-measure when the header un-hides: on mobileFullBleed pages it's
    // hidden at mount (offsetHeight 0, skipped by the guard), so it must be
    // measured again when the user navigates to a page where it's shown. Same
    // applies after a checkout return, where the first render is the spinner and
    // the header isn't in the DOM yet.
  }, [activePage, isMobile, bannerOffset, syncingUpgrade]);

  // Check auth status on mount, after reconciling any checkout return so that every
  // consumer of /api/auth/status sees the tier the user just paid for
  useEffect(() => {
    const loadAuthStatus = () => fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setUserStatus(data);

        // Identify user with PostHog if authenticated. Skipped in cookieless
        // mode (no consent): a PII distinct_id would defeat the anonymous
        // server-side hashing.
        if (data.authenticated && window.posthog && !window.__phCookieless) {
          // Use posthog_distinct_id (email or tidalNNNNN) to coordinate with backend
          window.posthog.identify(data.posthog_distinct_id, {
            email: data.email,
            username: data.user,
            subscription_tier: data.tier,
            billing_period: data.billing_period,
            oauth_providers: data.oauth_providers || [],
            last_seen_at: new Date().toISOString()
          });

          // Sign the support widget's identity so tickets stay tied to the verified user
          if (data.posthog_identity_hash && typeof window.posthog.setIdentity === 'function') {
            window.posthog.setIdentity(data.posthog_distinct_id, data.posthog_identity_hash);
          }

          // Cache user context for analytics auto-inclusion
          setUserContext(data);
        }

        // Show modal for ALL lapsed users (on each fresh login)
        // BUT not if they already dismissed it this session via "Unplugged" button
        const dismissedThisSession = sessionStorage.getItem('lapsedModalDismissed') === 'true';
        if (data.is_lapsed && !dismissedThisSession) {
          setLapsedInfo({
            daysUntil90: data.days_until_90,
            lapseDate: data.lapse_date
          });
          setShowLapsedModal(true);
        }
      })
      .catch(err => console.error('Error checking auth status:', err));

    const reconcileCheckout = async () => {
      if (!CHECKOUT_RETURN.came) return;

      if (CHECKOUT_RETURN.sessionId) {
        try {
          // Bounded wait: if Stripe is slow, fall through and let the webhook land
          // rather than leaving the user staring at a spinner.
          const res = await fetch('/api/billing/sync-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: CHECKOUT_RETURN.sessionId }),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) {
            console.error('Checkout session sync failed:', res.status);
          }
        } catch (err) {
          console.error('Error reconciling checkout session:', err);
        }
      }

      clearCheckoutParams();
      setSyncingUpgrade(false);
    };

    reconcileCheckout().finally(loadAuthStatus);
  }, []);

  if (syncingUpgrade) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-100">
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" aria-hidden="true" />
          <span>Confirming your upgrade...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Guided Tour Component - suppressed on the return from Stripe Checkout */}
      <GuidedTour suppressed={CHECKOUT_RETURN.came} />

      {/* Cookie Consent Banner */}
      <CookieConsent />

      {/* Global autocreate completion watcher - shows modal when user is on a different page */}
      <AutocreateWatcher />

      {/* Ko-fi floating widget - shown only for free/dollarstore/basic tiers, and not on Practice/Routines/Items/Stats.
          Hidden while the mobile More sheet is open so it doesn't float over the sheet. */}
      {userStatus?.tier &&
        !mobileMoreOpen &&
        activePage !== 'Practice' &&
        activePage !== 'Routines' &&
        activePage !== 'Items' &&
        activePage !== 'Stats' && (
          <KofiWidget currentTier={userStatus.tier} bottomOffset={bottomNavPadding} />
        )}

      {/* Lapsed Subscription Modal */}
      <LapsedSubscriptionModal
        isOpen={showLapsedModal}
        onClose={() => setShowLapsedModal(false)}
        daysUntil90={lapsedInfo.daysUntil90}
        lapseDate={lapsedInfo.lapseDate}
      />

      {/* Unplugged Access Modal */}
      <UnpluggedAccessModal
        isOpen={showUnpluggedModal}
        onClose={() => setShowUnpluggedModal(false)}
        daysRemaining={userStatus?.days_remaining}
        targetPage={unpluggedTarget}
      />

      {/* Impersonation Banner - visible to admins impersonating a user */}
      {isImpersonating && (
        <ImpersonationBanner username={userStatus.user} />
      )}

      {/* Fixed Header - offset down when impersonation banner is showing.
          Hidden on mobile pages that render their own 52px top bar
          (Practice, Routines — see mobileFullBleed). */}
      <div ref={headerRef} className="fixed left-0 right-0 z-50 bg-gray-900" style={{top: `${bannerOffset}px`, display: mobileFullBleed ? 'none' : undefined}}>
        <div className="container mx-auto px-4 pt-4 pb-1">
          <h1 className="text-2xl sm:text-4xl font-bold text-orange-500 mb-2" data-tour="app-title">Guitar Practice Routine App</h1>
          <NavMenu
            className="mb-0"
            userStatus={userStatus}
            onUnpluggedAttempt={(page) => {
              setUnpluggedTarget(page.toLowerCase());
              setShowUnpluggedModal(true);
            }}
          />
        </div>
      </div>

      {/* Scrollable Content with dynamic top padding to account for fixed header + impersonation banner.
          On mobileFullBleed pages the app header is hidden and the mobile view
          is full-bleed with its own top bar. */}
      <div
        className={`pb-4 container mx-auto ${mobileFullBleed ? 'px-0' : 'px-4'}`}
        style={{
          paddingTop: mobileFullBleed ? `${bannerOffset}px` : `${headerHeight + bannerOffset}px`,
          // Clearance for the fixed tab bar. It used to hang off the footer, but
          // the footer is hidden on mobile now — and pages that aren't full-bleed
          // (Account, Imports) have no other bottom padding of their own.
          paddingBottom: bottomNavPadding ? `${bottomNavPadding}px` : undefined,
        }}
      >
        {/* Deletion Banner - shows when account deletion is scheduled */}
        {userStatus?.deletion_scheduled_for && (
          <DeletionBanner
            deletionDate={userStatus.deletion_scheduled_for}
            deletionType={userStatus.deletion_type}
            refundAmount={userStatus.prorated_refund_amount || 0}
          />
        )}

        <PageContent userStatus={userStatus} />
      </div>

      {/* Mobile bottom tab bar (replaces the header nav tabs on <640px) */}
      {isMobile && (
        <MobileTabBar
          userStatus={userStatus}
          onMoreToggle={setMobileMoreOpen}
          onUnpluggedAttempt={(page) => {
            setUnpluggedTarget(page.toLowerCase());
            setShowUnpluggedModal(true);
          }}
        />
      )}

      {/* Footer. Hidden on mobile, where these links live in the More sheet —
          a row of small text links sitting above the tab bar read as leftover
          desktop chrome. */}
      <footer
        className="bg-gray-800 border-t border-gray-700 mt-8 py-6"
        style={{ marginBottom: bottomNavPadding ? `${bottomNavPadding}px` : undefined, display: isMobile ? 'none' : undefined }}
      >
        <div className="container mx-auto px-4 text-center text-sm text-gray-400">
          <div className="space-x-4">
            <a href="/about" className="hover:text-orange-400 transition-colors">
              About
            </a>
            <span>·</span>
            <a href="/faq" className="hover:text-orange-400 transition-colors">
              Help
            </a>
            <span>·</span>
            <a href="/terms" className="hover:text-orange-400 transition-colors">
              Terms
            </a>
            <span>·</span>
            <a href="/privacy" className="hover:text-orange-400 transition-colors">
              Privacy
            </a>
            <span>·</span>
            <a href="/#Account" className="hover:text-orange-400 transition-colors">
              Upgrade
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NavigationProvider>
        <App />
      </NavigationProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
