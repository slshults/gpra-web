import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Loader2, Tag, CheckCircle, XCircle, TrendingUp } from 'lucide-react';

/**
 * Modal for confirming subscription upgrades with proration preview and promo code support.
 *
 * Shows the user exactly what they'll be charged before confirming the upgrade.
 */
const UpgradeConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  targetTier,
  targetTierName,
  billingPeriod = 'monthly',
  currentTier,
}) => {
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [prorationData, setProrationData] = useState(null);

  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState(null); // { valid, promotion_code_id, description, ... }
  const [promoError, setPromoError] = useState(null);

  // Fetch proration preview when modal opens or promo code changes
  useEffect(() => {
    if (isOpen && targetTier) {
      fetchProrationPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, targetTier, promoResult?.promotion_code_id]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPromoCode('');
      setPromoResult(null);
      setPromoError(null);
      setProrationData(null);
      setError(null);
    }
  }, [isOpen]);

  const fetchProrationPreview = async () => {
    setLoading(true);
    setError(null);

    try {
      const body = {
        tier: targetTier,
        billing_period: billingPeriod,
      };

      // Include promo code if validated
      if (promoResult?.promotion_code_id) {
        body.promotion_code_id = promoResult.promotion_code_id;
      }

      const response = await fetch('/api/billing/preview-upgrade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to preview upgrade');
        setLoading(false);
        return;
      }

      setProrationData(data);
    } catch (err) {
      setError('Error connecting to server');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPromoCode = async () => {
    if (!promoCode.trim()) return;

    setPromoLoading(true);
    setPromoError(null);
    setPromoResult(null);

    try {
      const response = await fetch('/api/billing/validate-promo-code', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim() }),
      });

      const data = await response.json();

      if (data.valid) {
        setPromoResult(data);
        // Proration will be re-fetched by useEffect when promoResult changes
      } else {
        setPromoError(data.error || 'Invalid promo code');
      }
    } catch (err) {
      setPromoError('Error validating promo code');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromoCode = () => {
    setPromoCode('');
    setPromoResult(null);
    setPromoError(null);
    // Proration will be re-fetched by useEffect when promoResult becomes null
  };

  const handleConfirm = async () => {
    setConfirming(true);

    try {
      const body = {
        tier: targetTier,
        billing_period: billingPeriod,
      };

      // Include promo code if validated
      if (promoResult?.promotion_code_id) {
        body.promotion_code_id = promoResult.promotion_code_id;
      }

      const response = await fetch('/api/billing/update-subscription', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to update subscription');
        setConfirming(false);
        return;
      }

      // Success - call parent handler with the response data
      onConfirm(data);
    } catch (err) {
      setError('Error connecting to server');
      setConfirming(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && promoCode.trim() && !promoLoading) {
      handleApplyPromoCode();
    }
  };

  if (!isOpen) return null;

  const displayTierName = targetTierName || targetTier;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <TrendingUp className="h-6 w-6 text-orange-500" />
            Upgrade to {displayTierName}
          </DialogTitle>
          <DialogDescription className="text-left mt-4">
            Review your upgrade details before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Promo Code Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Have a promo code?
            </label>
            {promoResult ? (
              // Show applied promo code
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <span className="font-medium text-green-800 dark:text-green-300">
                      {promoCode.toUpperCase()}
                    </span>
                    <span className="text-sm text-green-600 dark:text-green-400 ml-2">
                      {promoResult.description}
                      {promoResult.duration_description && ` ${promoResult.duration_description}`}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemovePromoCode}
                  className="text-green-600 hover:text-green-700 dark:text-green-400"
                >
                  Remove
                </Button>
              </div>
            ) : (
              // Show promo code input
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Enter code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  onKeyPress={handleKeyPress}
                  disabled={promoLoading}
                  className="flex-1 bg-white dark:bg-gray-800"
                />
                <Button
                  onClick={handleApplyPromoCode}
                  disabled={!promoCode.trim() || promoLoading}
                  className="bg-gray-600 hover:bg-gray-700"
                >
                  {promoLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Tag className="h-4 w-4 mr-1" />
                      Apply
                    </>
                  )}
                </Button>
              </div>
            )}
            {promoError && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <XCircle className="h-4 w-4" />
                {promoError}
              </div>
            )}
          </div>

          {/* Proration Preview */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  Calculating...
                </span>
              </div>
            ) : error ? (
              <div className="text-red-600 dark:text-red-400 text-center py-2">
                {error}
              </div>
            ) : prorationData ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">
                    Charged today:
                  </span>
                  <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    ${prorationData.proration_amount.toFixed(2)}
                  </span>
                </div>

                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {prorationData.proration_details}
                </div>

                {prorationData.discount && (
                  <div className="flex justify-between items-center text-green-600 dark:text-green-400">
                    <span>Discount applied:</span>
                    <span>{prorationData.discount.description}</span>
                  </div>
                )}

                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      Then ${prorationData.new_price}/{billingPeriod === 'yearly' ? 'year' : 'month'}
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Error message */}
          {error && !loading && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-6">
          <Button
            onClick={onClose}
            disabled={confirming}
            className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 dark:bg-gray-600 dark:hover:bg-gray-700 dark:text-gray-200"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || confirming || !!error}
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Upgrading...
              </>
            ) : (
              'Confirm upgrade'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeConfirmationModal;
