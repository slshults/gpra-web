import { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card';
import { Loader2, Check, CreditCard, ChevronRight, ChevronDown } from 'lucide-react';
import SubscriptionModal from './SubscriptionModal';

const PricingSection = ({ currentTier = 'free', currentBillingPeriod = null }) => {
  // Initialize billing period from current user's subscription, default to monthly
  const [billingPeriod, setBillingPeriod] = useState(currentBillingPeriod || 'monthly');
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', message: '' });
  const [unpluggedMode, setUnpluggedMode] = useState(false);
  const [actualTier, setActualTier] = useState('free'); // Track actual tier (before unplugged override)

  // Collapsed state for tier cards - persist to sessionStorage
  const [collapsedTiers, setCollapsedTiers] = useState(() => {
    const saved = sessionStorage.getItem('pricingTiersCollapsed');
    // Default: all collapsed except current tier
    return saved ? JSON.parse(saved) : {
      free: true,
      basic: true,
      thegoods: true,
      moregoods: true,
      themost: true,
      rollyourown: true
    };
  });

  // Toggle tier card collapse state
  const toggleTier = (tierId) => {
    setCollapsedTiers(prev => {
      const newState = { ...prev, [tierId]: !prev[tierId] };
      sessionStorage.setItem('pricingTiersCollapsed', JSON.stringify(newState));
      return newState;
    });
  };

  // Fetch unplugged mode status on mount
  useEffect(() => {
    const fetchUnpluggedStatus = async () => {
      try {
        const response = await fetch('/api/auth/status');
        if (response.ok) {
          const data = await response.json();
          setUnpluggedMode(data.unplugged_mode || false);
          // Store actual tier from DB (before override)
          setActualTier(data.actual_tier || 'free');
        }
      } catch (error) {
        console.error('Error fetching unplugged status:', error);
      }
    };
    fetchUnpluggedStatus();
  }, []);

  const tiers = [
    {
      id: 'free',
      name: 'Free',
      itemsLimit: 15,
      routinesLimit: 1,
      priceMonthly: 0,
      priceYearly: 0,
      autocreate: false,
      description: 'Get started with basic features',
      byocNote: 'BYOClaude (enter your own Anthropic API key) for autocreated chord charts',
    },
    {
      id: 'basic',
      name: 'Basic',
      itemsLimit: 80,
      routinesLimit: 5,
      priceMonthly: 3,
      priceYearly: 27,
      autocreate: false,
      description: 'More items and routines',
      byocNote: 'BYOClaude (enter your own Anthropic API key) for autocreated chord charts',
    },
    {
      id: 'thegoods',
      name: 'The Goods',
      itemsLimit: 200,
      routinesLimit: 10,
      priceMonthly: 6,
      priceYearly: 54,
      autocreate: true,
      description: 'Includes Autocreate for chord charts',
    },
    {
      id: 'moregoods',
      name: 'More Goods',
      itemsLimit: 600,
      routinesLimit: 25,
      priceMonthly: 12,
      priceYearly: 100.80,
      autocreate: true,
      description: 'Even more items and routines',
    },
    {
      id: 'themost',
      name: 'The Most',
      itemsLimit: 1500,
      routinesLimit: 50,
      priceMonthly: 20,
      priceYearly: 168,
      autocreate: true,
      description: 'Goes to 11',
    },
  ];

  const getSubscriptionUpdateMessage = (details) => {
    const { old_tier, new_tier, tier_changed, period_changed, billing_period, proration_amount, autocreate_enabled } = details;

    // Tier names for display
    const tierNames = {
      'free': 'Free',
      'basic': 'Basic',
      'thegoods': 'The Goods',
      'moregoods': 'More Goods',
      'themost': 'The Most'
    };

    const newTierName = tierNames[new_tier] || new_tier;
    const oldTierName = tierNames[old_tier] || old_tier;

    // Billing period change (same tier, different period)
    if (period_changed && !tier_changed) {
      const periodName = billing_period === 'yearly' ? 'yearly' : 'monthly';
      const nextBilling = billing_period === 'yearly' ? 'one year' : 'one month';

      return {
        title: '✅ Billing Updated',
        message: `Cool, you're upgraded to ${periodName} billing${proration_amount > 0 ? `, with a prorated charge of $${proration_amount.toFixed(2)} usd` : ''}. We'll bill you again in ${nextBilling}, unless you use the "Manage Subscription" button to downgrade or cancel before then. 🤘Rock on!`
      };
    }

    // Tier upgrade (with or without period change)
    if (tier_changed && new_tier !== 'basic') {
      const baseMessage = `Right on, you've upgraded to ${newTierName}!`;
      const proratedText = proration_amount > 0 ? ` Your card was charged a prorated amount of $${proration_amount.toFixed(2)} usd.` : '';

      if (autocreate_enabled && old_tier === 'basic') {
        return {
          title: '🎉 Upgraded!',
          message: `${baseMessage}${proratedText} You're ready to add more items, organize more routines, and have your chord charts autocreated! 🤘Rock on!`
        };
      } else {
        return {
          title: '🎉 Upgraded!',
          message: `${baseMessage}${proratedText} You're ready to add more items and organize more routines! 🤘Rock on!`
        };
      }
    }

    // Tier downgrade
    if (tier_changed && (old_tier !== 'basic' && new_tier === 'basic')) {
      return {
        title: 'Plan Changed',
        message: `You've downgraded to ${newTierName}. Your new limits will take effect immediately. Thanks for sticking with us! 🎸`
      };
    }

    // Generic tier change
    if (tier_changed) {
      return {
        title: 'Plan Updated',
        message: `You've switched to ${newTierName}. Rock on! 🤘`
      };
    }

    // Fallback
    return {
      title: 'Subscription Updated',
      message: 'Your subscription has been updated successfully. 🎸'
    };
  };

  const handleUpgrade = async (tierId, billingPeriodOverride = null) => {
    if (tierId === 'free') return;

    setLoading(tierId);
    setError(null);

    // Use the override if provided (from toggle buttons), otherwise use state
    const period = billingPeriodOverride || billingPeriod;

    try {
      // Check if user already has a subscription (not on free tier)
      // Use actualTier instead of currentTier to handle unplugged mode correctly
      // Unplugged users have actualTier !== 'free' but show as free
      const hasSubscription = actualTier !== 'free';

      // If user is unplugged (canceled/paused), they need a NEW checkout session
      // Cannot use update-subscription API on a canceled subscription
      const endpoint = (hasSubscription && !unpluggedMode)
        ? '/api/billing/update-subscription'  // Existing ACTIVE customers - update in place
        : '/api/billing/create-checkout-session';  // New customers OR unplugged users - use checkout

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',  // Include cookies for authentication
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: tierId,
          billing_period: period,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to process request');
        setLoading(null);
        return;
      }

      // Check if we got back a checkout URL (new checkout) or update confirmation
      if (data.url) {
        // New checkout session OR unplugged user reactivating - redirect to Stripe
        window.location.href = data.url;
      } else if (data.details) {
        // Subscription updated in-place, show custom modal
        const modalContent = getSubscriptionUpdateMessage(data.details || {});
        setModalContent(modalContent);
        setModalOpen(true);
        setLoading(null);
      } else {
        // Unexpected response format
        setError('Unexpected response from server');
        setLoading(null);
      }
    } catch (err) {
      // Use modal for errors too
      setModalContent({
        title: '❌ Error',
        message: `Error: ${err.message || 'Error connecting to payment system'}`
      });
      setModalOpen(true);
      setLoading(null);
    }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    // Reload page to refresh subscription status
    window.location.reload();
  };

  const handleManageSubscription = async () => {
    setLoading('portal');
    setError(null);

    try {
      const response = await fetch('/api/billing/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to open subscription portal');
        setLoading(null);
      }
    } catch (_err) {
      setError('Error connecting to subscription portal');
      setLoading(null);
    }
  };

  const handleUnpause = async () => {
    setLoading('unpause');
    setError(null);

    try {
      const response = await fetch('/api/billing/unpause-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (response.ok) {
        setModalContent({
          title: '✅ Subscription Resumed',
          message: 'Welcome back! Your subscription has been reactivated. You now have access to all your routines and features. 🎸'
        });
        setModalOpen(true);
      } else {
        setError(data.error || 'Failed to unpause subscription');
        setLoading(null);
      }
    } catch (_err) {
      setError('Error unpausing subscription');
      setLoading(null);
    }
  };

  const getTierIndex = (tierId) => tiers.findIndex(t => t.id === tierId);
  const currentTierIndex = getTierIndex(currentTier);

  const getButtonText = (tierIndex) => {
    if (tierIndex === currentTierIndex) return 'Current Plan';
    if (tierIndex < currentTierIndex) return 'Downgrade';
    return 'Upgrade';
  };

  // Calculate savings for current tier
  const currentTierData = tiers.find(t => t.id === currentTier);
  const savings = currentTierData ? (currentTierData.priceMonthly * 12 - currentTierData.priceYearly).toFixed(2) : 0;
  const savingsPercent = currentTierData && currentTierData.priceMonthly > 0
    ? Math.round(((currentTierData.priceMonthly * 12 - currentTierData.priceYearly) / (currentTierData.priceMonthly * 12)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Unplugged Mode Warning Banner */}
      {unpluggedMode && (
        <Card className="bg-orange-900/20 border-orange-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-semibold text-orange-300 mb-1">Your subscription is paused</h3>
                <p className="text-sm text-gray-300">
                  You're currently in free mode with access to your last active routine. Click "Unpause" to restore full access to all your routines and features.
                </p>
              </div>
              <Button
                onClick={handleUnpause}
                disabled={loading === 'unpause'}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading === 'unpause' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Unpausing...
                  </>
                ) : (
                  'Unpause Subscription'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-md p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Pricing Cards - Vertical stack with collapsible cards */}
      <div className="space-y-4">
        {tiers.map((tier, index) => {
          // For the current tier card, show prices based on actual billing period
          // For other cards, show prices based on the selected toggle in the header
          const displayPeriod = tier.id === currentTier && currentBillingPeriod ? currentBillingPeriod : billingPeriod;
          const price = displayPeriod === 'monthly' ? tier.priceMonthly : tier.priceYearly;
          const isCurrent = tier.id === currentTier;
          const isLoadingThis = loading === tier.id;

          const isCollapsed = collapsedTiers[tier.id];

          return (
            <Card
              key={tier.id}
              className={`relative bg-gray-800 border-gray-700 ${
                isCurrent ? 'border-orange-600 border-2' : ''
              }`}
            >
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => toggleTier(tier.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-gray-100 text-lg flex items-center gap-2">
                      {tier.name}
                      {isCurrent && (
                        <span className="text-xs font-normal text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
                          Your current plan
                        </span>
                      )}
                      {isCollapsed && price > 0 && (
                        <span className="text-sm font-normal text-gray-400">
                          ${price}/{displayPeriod === 'monthly' ? 'mo' : 'yr'}
                        </span>
                      )}
                      {isCollapsed && price === 0 && (
                        <span className="text-sm font-normal text-gray-400">Free</span>
                      )}
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-xs">
                      {tier.description}
                    </CardDescription>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </CardHeader>

              {!isCollapsed && (
              <CardContent className="space-y-3">
                {/* Price */}
                <div className="text-center py-2">
                  {price === 0 ? (
                    <div className="text-3xl font-bold text-gray-100">Free</div>
                  ) : (
                    <div className="text-3xl font-bold text-gray-100">
                      ${price}
                      <span className="text-sm text-gray-400 font-normal">
                        usd/{displayPeriod === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                    <span>{tier.itemsLimit} items</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                    <span>{tier.routinesLimit} {tier.routinesLimit === 1 ? 'routine' : 'routines'}</span>
                  </li>
                  {tier.autocreate && (
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="font-medium text-orange-400">Includes Autocreate for chord charts</span>
                    </li>
                  )}
                </ul>

                {/* BYOC Note for Basic tier */}
                {tier.byocNote && (
                  <div className="text-xs text-gray-300">
                    {tier.byocNote}
                  </div>
                )}

                {/* CTA Button or Billing Toggle for current plan */}
                {tier.id !== 'free' && (
                  <>
                    {isCurrent && currentTier !== 'free' ? (
                      // Show billing period toggle on current paid plan card
                      <div className="flex items-center gap-2 bg-gray-700 rounded-lg p-1 border border-gray-600">
                        <button
                          onClick={() => handleUpgrade(currentTier, 'monthly')}
                          disabled={loading === currentTier}
                          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                            currentBillingPeriod === 'monthly'
                              ? 'bg-orange-600 text-white'
                              : 'text-gray-400 hover:text-gray-300'
                          } disabled:opacity-50`}
                        >
                          Monthly
                          {currentBillingPeriod === 'yearly' && tier.priceMonthly > 0 && (
                            <span className="block text-[10px] opacity-90">
                              (Pay ${(tier.priceMonthly - (tier.priceYearly / 12)).toFixed(2)} more/mo)
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => handleUpgrade(currentTier, 'yearly')}
                          disabled={loading === currentTier}
                          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                            currentBillingPeriod === 'yearly'
                              ? 'bg-orange-600 text-white'
                              : 'text-gray-400 hover:text-gray-300'
                          } disabled:opacity-50`}
                        >
                          Yearly
                          {currentBillingPeriod === 'monthly' && savingsPercent > 0 && (
                            <span className="block text-[10px] opacity-90">
                              (Save {savingsPercent}%/${savings})
                            </span>
                          )}
                        </button>
                      </div>
                    ) : (
                      // Show upgrade/downgrade button for other tiers
                      <Button
                        onClick={() => handleUpgrade(tier.id)}
                        disabled={isLoadingThis}
                        className={`w-full ${
                          index > currentTierIndex
                            ? 'bg-orange-600 hover:bg-orange-700'
                            : 'bg-gray-700 hover:bg-gray-600 border border-gray-600'
                        }`}
                      >
                        {isLoadingThis ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          getButtonText(index)
                        )}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
              )}
            </Card>
          );
        })}

        {/* Roll your own card */}
        <Card className="relative bg-gray-800 border-gray-700">
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => toggleTier('rollyourown')}
          >
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-gray-100 text-lg">Roll your own</CardTitle>
                <CardDescription className="text-gray-400 text-xs">
                  Local-only, on your laptop or desktop
                </CardDescription>
              </div>
              {collapsedTiers.rollyourown ? (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </div>
          </CardHeader>

          {!collapsedTiers.rollyourown && (
          <CardContent className="space-y-3">
            {/* Price */}
            <div className="text-center py-2">
              <div className="text-2xl font-bold text-gray-100">Time and effort</div>
            </div>

            {/* Requirements */}
            <div className="text-xs font-semibold text-gray-400 mb-1">Requirements:</div>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>Familiarity with Linux CLI</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>Familiarity with GitHub</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>Familiarity with using APIs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>Familiarity with being a nerd</span>
              </li>
            </ul>

            {/* CTA Button */}
            <Button
              onClick={() => window.open('https://github.com/slshults/guitar-practice-routine-app_postgresql/blob/main/README.md', '_blank')}
              className="w-full bg-gray-700 hover:bg-gray-600 border border-gray-600"
            >
              Get it from GitHub
            </Button>
          </CardContent>
          )}
        </Card>
      </div>

      {/* Manage Subscription Button (for users with actual subscriptions, including unplugged) */}
      {actualTier !== 'free' && (
        <Card className="bg-gray-800 border-gray-700 mt-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-100 mb-1">Manage your subscription</h3>
                <p className="text-sm text-gray-400">
                  {unpluggedMode
                    ? 'Reactivate your subscription or view billing details'
                    : 'Log in to your Stripe account to update your payment method, view invoices, view payment history, etc.'}
                </p>
              </div>
              <Button
                onClick={handleManageSubscription}
                disabled={loading === 'portal'}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {loading === 'portal' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Stripe billing portal
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Update Modal */}
      <SubscriptionModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        title={modalContent.title}
        message={modalContent.message}
      />
    </div>
  );
};

export default PricingSection;
