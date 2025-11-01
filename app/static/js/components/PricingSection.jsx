import { useState } from 'react';
import { Button } from '@ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card';
import { Loader2, Check, CreditCard } from 'lucide-react';

const PricingSection = ({ currentTier = 'free' }) => {
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

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
      description: 'For serious practice routines',
    },
    {
      id: 'themost',
      name: 'The Most',
      itemsLimit: 1500,
      routinesLimit: 50,
      priceMonthly: 20,
      priceYearly: 168,
      autocreate: true,
      description: 'Unlimited potential',
    },
  ];

  const handleUpgrade = async (tierId, billingPeriodOverride = null) => {
    if (tierId === 'free') return;

    setLoading(tierId);
    setError(null);

    // Use the override if provided (from toggle buttons), otherwise use state
    const period = billingPeriodOverride || billingPeriod;

    try {
      const response = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: tierId,
          billing_period: period,
        }),
      });

      const data = await response.json();

      if (response.ok && data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to create checkout session');
        setLoading(null);
      }
    } catch (_err) {
      setError('Error connecting to payment system');
      setLoading(null);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="mt-4">
        <h2 className="text-2xl font-bold text-gray-100">Subscription plans</h2>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-md p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {tiers.map((tier, index) => {
          const price = billingPeriod === 'monthly' ? tier.priceMonthly : tier.priceYearly;
          const isCurrent = tier.id === currentTier;
          const isLoadingThis = loading === tier.id;

          return (
            <Card
              key={tier.id}
              className={`relative bg-gray-800 border-gray-700 ${
                isCurrent ? 'border-orange-600 border-2' : ''
              }`}
            >

              <CardHeader className="pb-4">
                <CardTitle className="text-gray-100 text-lg flex items-center gap-2">
                  {tier.name}
                  {isCurrent && (
                    <span className="text-xs font-normal text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
                      Your current plan
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-gray-400 text-xs h-8">
                  {tier.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Price */}
                <div className="text-center py-4">
                  {price === 0 ? (
                    <div className="text-3xl font-bold text-gray-100">Free</div>
                  ) : (
                    <div className="text-3xl font-bold text-gray-100">
                      ${price}
                      <span className="text-sm text-gray-400 font-normal">
                        usd/{billingPeriod === 'monthly' ? 'mo' : 'yr'}
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
                            billingPeriod === 'monthly'
                              ? 'bg-orange-600 text-white'
                              : 'text-gray-400 hover:text-gray-300'
                          } disabled:opacity-50`}
                        >
                          Monthly
                        </button>
                        <button
                          onClick={() => handleUpgrade(currentTier, 'yearly')}
                          disabled={loading === currentTier}
                          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                            billingPeriod === 'yearly'
                              ? 'bg-orange-600 text-white'
                              : 'text-gray-400 hover:text-gray-300'
                          } disabled:opacity-50`}
                        >
                          Yearly (Save {savingsPercent}%/${savings})
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
            </Card>
          );
        })}
      </div>

      {/* Manage Subscription Button (for paid users) */}
      {currentTier !== 'free' && (
        <Card className="bg-gray-800 border-gray-700 mt-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-100 mb-1">Manage your subscription</h3>
                <p className="text-sm text-gray-400">
                  Update payment method, view invoices, or cancel your subscription
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
                    Manage Subscription
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PricingSection;
