import React, { useState, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select';
import { Button } from '@ui/button';
import { Card, CardContent } from '@ui/card';
import StatCards from '@components/stats/StatCards';
import DailyPracticeChart from '@components/stats/DailyPracticeChart';
import TopItemsChart from '@components/stats/TopItemsChart';
import { Loader2 } from 'lucide-react';
import { debugLog } from '@utils/logging';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

const StatsPage = ({ userStatus }) => {
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const hasTrackedView = useRef(false);

  // Track page view once on mount
  useEffect(() => {
    if (!hasTrackedView.current && window.posthog) {
      hasTrackedView.current = true;
      window.posthog.capture('practice_stats_viewed', {
        initial_period: period,
      });
    }
  }, []);

  // Fetch stats whenever period changes
  useEffect(() => {
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
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
          debugLog('Stats', 'Fetch error:', err.message);
        }
      });

    return () => { cancelled = true; };
  }, [period, retryCount]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    if (window.posthog) {
      window.posthog.capture('practice_stats_period_changed', {
        from_period: period,
        to_period: newPeriod,
      });
    }
  };

  // Free tier upsell
  if (userStatus?.tier === 'free') {
    return (
      <div className="max-w-2xl mx-auto mt-8 text-center">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8">
            <h2 className="text-xl font-semibold text-white mb-3">Practice stats</h2>
            <p className="text-gray-400 mb-6">
              Upgrade to a paid plan to see your practice statistics, including daily practice time, most practiced items, and session trends.
            </p>
            <Button
              onClick={() => {
                window.location.hash = 'Account';
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              View plans
            </Button>
          </CardContent>
        </Card>
      </div>
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
              onClick={() => setRetryCount((c) => c + 1)}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          <StatCards summary={data.summary} />
          <DailyPracticeChart data={data.daily} />
          <TopItemsChart data={data.top_items} />
        </>
      )}
    </div>
  );
};

export default StatsPage;
