import { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card';
import { Loader2, Check, CreditCard, ChevronRight, ChevronDown } from 'lucide-react';
import SubscriptionModal from './SubscriptionModal';
import UpgradeConfirmationModal from './UpgradeConfirmationModal';

const PricingSection = ({ currentTier = 'free', onSubscriptionChange }) => {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', message: '' });
  const [unpluggedMode, setUnpluggedMode] = useState(false);
  const [actualTier, setActualTier] = useState('free'); // Track actual tier (before unplugged override)

  // Upgrade confirmation modal state
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState(null); // { tierId, tierName }

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
      price: 0,
      autocreate: false,
      description: 'Get started with basic features',
      byocNote: 'BYOClaude (enter your own Anthropic API key) for autocreated chord charts',
    },
    {
      id: 'basic',
      name: 'Basic',
      itemsLimit: 80,
      routinesLimit: 5,
      price: 3,
      autocreate: false,
      description: 'More items and routines',
      byocNote: 'BYOClaude (enter your own Anthropic API key) for autocreated chord charts',
    },
    {
      id: 'thegoods',
      name: 'The Goods',
      itemsLimit: 200,
      routinesLimit: 10,
      price: 6,
      autocreate: true,
      description: 'Includes Autocreate for chord charts',
    },
    {
      id: 'moregoods',
      name: 'More Goods',
      itemsLimit: 600,
      routinesLimit: 25,
      price: 12,
      autocreate: true,
      description: 'Even more items and routines',
    },
    {
      id: 'themost',
      name: 'The Most',
      itemsLimit: 1500,
      routinesLimit: 50,
      price: 20,
      autocreate: true,
      description: 'Goes to 11',
    },
  ];

  const getSubscriptionUpdateMessage = (details) => {
    const { old_tier, new_tier, tier_changed, proration_amount, autocreate_enabled } = details;

    // Tier names for display
    const tierNames = {
      'free': 'Free',
      'basic': 'Basic',
      'thegoods': 'The Goods',
      'moregoods': 'More Goods',
      'themost': 'The Most'
    };

    const newTierName = tierNames[new_tier] || new_tier;

    // Tier ordering (index determines hierarchy)
    const tierOrder = ['free', 'basic', 'thegoods', 'moregoods', 'themost'];
    const oldTierIndex = tierOrder.indexOf(old_tier);
    const newTierIndex = tierOrder.indexOf(new_tier);

    // Tier downgrade (moving to a lower tier index)
    if (tier_changed && newTierIndex < oldTierIndex) {
      return {
        title: 'Plan Changed',
        message: `You've downgraded to ${newTierName}. Your new limits will take effect immediately. Thanks for sticking with us! 🎸`
      };
    }

    // Tier upgrade (moving to a higher tier index)
    if (tier_changed && newTierIndex > oldTierIndex) {
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

    // Generic tier change (same tier index, shouldn't happen but handle it)
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

  const handleUpgrade = async (tierId) => {
    if (tierId === 'free') return;

    // Check if user already has an ACTIVE subscription (not on free tier and not unplugged)
    // Use actualTier instead of currentTier to handle unplugged mode correctly
    const hasActiveSubscription = actualTier !== 'free' && !unpluggedMode;

    // Tier ordering for upgrade/downgrade detection
    const tierOrder = ['free', 'basic', 'thegoods', 'moregoods', 'themost'];
    const currentTierIndex = tierOrder.indexOf(actualTier);
    const targetTierIndex = tierOrder.indexOf(tierId);
    const isUpgrade = targetTierIndex > currentTierIndex;

    // For ACTIVE subscribers UPGRADING: show confirmation modal with proration preview
    // Downgrades skip the modal and go directly to update endpoint (which has its own confirmation)
    if (hasActiveSubscription && isUpgrade) {
      const tier = tiers.find(t => t.id === tierId);
      setUpgradeTarget({
        tierId,
        tierName: tier?.name || tierId,
      });
      setUpgradeModalOpen(true);
      return;
    }

    // For downgrades, go directly to the update-subscription endpoint
    if (hasActiveSubscription && !isUpgrade) {
      setLoading(tierId);
      setError(null);

      try {
        const response = await fetch('/api/billing/update-subscription', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier: tierId,
            billing_period: 'monthly',
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Failed to update subscription');
          setLoading(null);
          return;
        }

        // Show success modal with downgrade message
        if (data.details) {
          const content = getSubscriptionUpdateMessage(data.details);
          setModalContent(content);
          setModalOpen(true);
        }
        setLoading(null);
      } catch (err) {
        setModalContent({
          title: 'Error',
          message: `Error: ${err.message || 'Error updating subscription'}`
        });
        setModalOpen(true);
        setLoading(null);
      }
      return;
    }

    // For new customers or unplugged users: use Stripe Checkout directly
    setLoading(tierId);
    setError(null);

    try {
      const response = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: tierId,
          billing_period: 'monthly',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Special case: backend tells us to use update endpoint instead
        // This prevents double-billing if frontend state was stale
        if (data.use_update_endpoint) {
          console.log('Backend redirecting to upgrade confirmation modal');
          const tier = tiers.find(t => t.id === tierId);
          setUpgradeTarget({
            tierId,
            tierName: tier?.name || tierId,
          });
          setUpgradeModalOpen(true);
          setLoading(null);
          return;
        }

        setError(data.error || 'Failed to process request');
        setLoading(null);
        return;
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError('Unexpected response from server');
        setLoading(null);
      }
    } catch (err) {
      setModalContent({
        title: 'Error',
        message: `Error: ${err.message || 'Error connecting to payment system'}`
      });
      setModalOpen(true);
      setLoading(null);
    }
  };

  // Handle successful upgrade from confirmation modal
  const handleUpgradeConfirm = (data) => {
    setUpgradeModalOpen(false);
    setUpgradeTarget(null);

    if (data.details) {
      const content = getSubscriptionUpdateMessage(data.details);
      setModalContent(content);
      setModalOpen(true);
    }
  };

  // Handle upgrade modal close (cancel)
  const handleUpgradeModalClose = () => {
    setUpgradeModalOpen(false);
    setUpgradeTarget(null);
  };

  const handleModalClose = async () => {
    setModalOpen(false);
    // Refresh subscription status via callback (avoids full page reload)
    if (onSubscriptionChange) {
      await onSubscriptionChange();
    }
    // Also refresh local unplugged/actualTier state
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const data = await response.json();
        setUnpluggedMode(data.unplugged_mode || false);
        setActualTier(data.actual_tier || 'free');
      }
    } catch (error) {
      console.error('Error refreshing subscription status:', error);
    }
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
                data-ph-capture-attribute-toggle={`pricing-tier-${tier.id}`}
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
                      {isCollapsed && tier.price > 0 && (
                        <span className="text-sm font-normal text-gray-400">
                          ${tier.price}/mo
                        </span>
                      )}
                      {isCollapsed && tier.price === 0 && (
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
                  {tier.price === 0 ? (
                    <div className="text-3xl font-bold text-gray-100">Free</div>
                  ) : (
                    <div className="text-3xl font-bold text-gray-100">
                      ${tier.price}
                      <span className="text-sm text-gray-400 font-normal">
                        usd/mo
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

                {/* CTA Button for non-current tiers */}
                {tier.id !== 'free' && !isCurrent && (
                  <Button
                    onClick={() => handleUpgrade(tier.id)}
                    disabled={isLoadingThis}
                    className={`w-full ${
                      index > currentTierIndex
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-gray-700 hover:bg-gray-600 border border-gray-600'
                    }`}
                    data-ph-capture-attribute-button={index > currentTierIndex ? `upgrade-to-${tier.id}` : `downgrade-to-${tier.id}`}
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
            data-ph-capture-attribute-toggle="pricing-tier-rollyourown"
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
              data-ph-capture-attribute-button="github-roll-your-own"
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
                data-ph-capture-attribute-button="stripe-billing-portal"
              >
                {loading === 'portal' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Loading...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" />
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

      {/* Upgrade Confirmation Modal (shows proration preview) */}
      <UpgradeConfirmationModal
        isOpen={upgradeModalOpen}
        onClose={handleUpgradeModalClose}
        onConfirm={handleUpgradeConfirm}
        targetTier={upgradeTarget?.tierId}
        targetTierName={upgradeTarget?.tierName}
        billingPeriod="monthly"
        currentTier={currentTier}
      />
    </div>
  );
};

export default PricingSection;
