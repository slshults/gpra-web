import React, { useState, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select';
import { Button } from '@ui/button';
import { Card, CardContent } from '@ui/card';
import StatCards from '@components/stats/StatCards';
import DailyPracticeChart from '@components/stats/DailyPracticeChart';
import TopItemsChart from '@components/stats/TopItemsChart';
import StatsConsentModal from '@components/StatsConsentModal';
import StatsConsentFollowUpModal from '@components/StatsConsentFollowUpModal';
import MobileStatsPage from '@components/MobileStatsPage';
import { useIsMobile } from '@hooks/useIsMobile';
import { Loader2 } from 'lucide-react';
import { debugLog } from '@utils/logging';
import { trackStatsEvent } from '@utils/analytics';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

// Analytics tracking is on when the user accepted all cookies, or in opt-out
// regions where PostHog loads by default and no explicit choice was made.
const analyticsConsentGiven = () => {
  const consent = localStorage.getItem('cookieConsent');
  if (consent === 'all') return true;
  if (!consent && window.__consentMode === 'opt-out') return true;
  return false;
};

const StatsPage = ({ userStatus }) => {
  const isMobile = useIsMobile();
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentFollowUp, setConsentFollowUp] = useState(null); // null | 'accepted' | 'declined'
  const [timerImagePinned, setTimerImagePinned] = useState(false);
  const [timerImageHovered, setTimerImageHovered] = useState(false);
  const hasTrackedView = useRef(false);
  const hasTrackedUpsell = useRef(false);

  const isFreeTier = userStatus?.tier === 'free';

  // Nudge users whose analytics cookies are off: their stats can't be collected.
  // Shows on every Stats page load so people can always change their minds.
  // After the Enable-cookies reload, a one-shot flag triggers the "all set" follow-up.
  useEffect(() => {
    if (isFreeTier) return;
    if (localStorage.getItem('statsConsentJustAccepted') === '1') {
      localStorage.removeItem('statsConsentJustAccepted');
      setConsentFollowUp('accepted');
      return;
    }
    if (analyticsConsentGiven()) return;
    setShowConsentModal(true);
  }, [isFreeTier]);

  // Any way of closing the consent modal without accepting (either button, X,
  // or Escape) leads to the friendly "no worries" follow-up.
  const handleConsentModalClose = () => {
    setShowConsentModal(false);
    setConsentFollowUp('declined');
  };

  // No practice data at all for the selected period — show the "how stats get
  // here" banner to users whose analytics is on but hasn't collected anything yet.
  const statsEmpty = !!data &&
    !(data.summary?.timers_started > 0) &&
    !(data.summary?.items_completed > 0) &&
    !(data.summary?.total_practice_seconds > 0) &&
    (data.daily?.length ?? 0) === 0;

  // Track page view once on mount (paid tiers only)
  useEffect(() => {
    if (isFreeTier) return;
    if (!hasTrackedView.current) {
      hasTrackedView.current = true;
      const now = new Date().toISOString();
      trackStatsEvent('practice_stats_viewed', {
        initial_period: period,
        $set: { last_stats_viewed_at: now },
        $set_once: { first_stats_viewed_at: now },
      });
    }
  }, [isFreeTier]);

  // Track upsell shown once when free-tier user lands on Stats
  useEffect(() => {
    if (isFreeTier && !hasTrackedUpsell.current) {
      hasTrackedUpsell.current = true;
      trackStatsEvent('practice_stats_upsell_shown');
    }
  }, [isFreeTier]);

  // Fetch stats whenever period changes
  useEffect(() => {
    if (isFreeTier) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/user/practice-stats?period=${period}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
          debugLog('Stats', 'Fetched stats for period:', period, json);
          trackStatsEvent('practice_stats_data_loaded', {
            period,
            has_data: (json.daily?.length ?? 0) > 0,
            top_items_count: json.top_items?.length ?? 0,
            total_practice_seconds: json.summary?.total_practice_seconds ?? 0,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
          debugLog('Stats', 'Fetch error:', err.message);
          trackStatsEvent('practice_stats_load_failed', {
            period,
            error_message: err.message,
          });
        }
      });

    return () => { cancelled = true; };
  }, [period, retryCount, isFreeTier]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    trackStatsEvent('practice_stats_period_changed', {
      from_period: period,
      to_period: newPeriod,
    });
  };

  const handleRetry = () => {
    trackStatsEvent('practice_stats_retry_clicked', {
      period,
      retry_count: retryCount + 1,
    });
    setRetryCount((c) => c + 1);
  };

  const handleUpsellClick = () => {
    trackStatsEvent('practice_stats_upsell_clicked', { action: 'view_plans' });
    window.location.hash = 'Account';
  };

  // Free tier upsell. Mobile takes its own branch first: Stats is full-bleed
  // there (the app header is hidden in favour of the page's own 52px bar), so
  // returning the desktop card here would leave it floating with no header.
  if (isFreeTier && isMobile) {
    return <MobileStatsPage isFreeTier onUpsellClick={handleUpsellClick} />;
  }

  if (isFreeTier) {
    return (
      <div className="max-w-2xl mx-auto mt-8 text-center">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8">
            <h2 className="text-xl font-semibold text-white mb-3">Practice stats</h2>
            <p className="text-gray-400 mb-6">
              Upgrade to a paid plan to see your practice statistics, including daily practice time, most practiced items, and session trends.
            </p>
            <Button
              onClick={handleUpsellClick}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              View plans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Rendered in both layouts, so the consent nudge behaves the same either way
  const consentModals = (
    <>
      <StatsConsentModal
        isOpen={showConsentModal}
        onClose={handleConsentModalClose}
      />

      <StatsConsentFollowUpModal
        variant={consentFollowUp}
        onClose={() => setConsentFollowUp(null)}
      />
    </>
  );

  // Mobile keeps this component as the state owner and swaps only the layout
  // (design 5b) — same data, same periods, same events.
  if (isMobile) {
    return (
      <>
        <MobileStatsPage
          period={period}
          onPeriodChange={handlePeriodChange}
          data={data}
          loading={loading}
          error={error}
          onRetry={handleRetry}
          showEmptyHint={statsEmpty && analyticsConsentGiven()}
        />
        {consentModals}
      </>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Practice stats</h2>
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-[160px] bg-gray-800 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
          <span className="ml-2 text-gray-400">Loading stats...</span>
        </div>
      )}

      {error && !loading && (
        <Card className="bg-gray-800 border-red-700">
          <CardContent className="p-6 text-center">
            <p className="text-red-400">Failed to load practice stats: {error}</p>
            <Button
              variant="ghost"
              className="mt-3 text-orange-400 hover:text-orange-300"
              onClick={handleRetry}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          {statsEmpty && analyticsConsentGiven() && (
            <div className="relative bg-orange-900/20 border border-orange-700/60 rounded-lg p-4 text-gray-200 text-sm">
              No stats yet. Use the{' '}
              <button
                type="button"
                className="text-orange-300 hover:text-orange-200 underline decoration-dotted underline-offset-4"
                onMouseEnter={() => setTimerImageHovered(true)}
                onMouseLeave={() => setTimerImageHovered(false)}
                onClick={() => setTimerImagePinned((v) => !v)}
              >
                timers and 'Mark done' buttons
              </button>{' '}
              in your items on the{' '}
              <a href="/#Practice" className="text-orange-400 hover:underline">
                Practice
              </a>{' '}
              page, then come back here later to see your stats.
              <br />
              (Keep cookies enabled to track stats.)
              {(timerImagePinned || timerImageHovered) && (
                <img
                  src="/static/images/practice-timer-demo.gif"
                  alt="Animated demo of a practice item timer counting down, with the Mark done button below it"
                  className="absolute left-4 top-full mt-2 z-40 w-[440px] max-w-[85vw] rounded-lg border border-gray-600 shadow-2xl"
                />
              )}
            </div>
          )}
          <StatCards summary={data.summary} />
          {period !== 'today' && <DailyPracticeChart data={data.daily} />}
          <TopItemsChart data={data.top_items} />
        </>
      )}

      {consentModals}
    </div>
  );
};

export default StatsPage;
