import React, { useState, useEffect } from 'react';

export default function LapsedSubscriptionModal({ isOpen, onClose, daysUntil90, lapseDate }) {
  const [loading, setLoading] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Returns the server's error message, logging the raw body (may be a non-JSON proxy page)
  const readErrorMessage = async (response, label) => {
    const text = await response.text();
    console.error(`${label} failed:`, response.status, text);
    try {
      const { error } = JSON.parse(text);
      return typeof error === 'string' ? error : null;
    } catch {
      return null;
    }
  };

  // Errors must never trap the user behind the modal: show the message and allow dismissing
  const handleError = (message, endpoint, status = null) => {
    window.posthog?.capture('lapsed_modal_error_shown', { endpoint, status });
    setErrorMessage(message);
    setLoading(false);
    sessionStorage.setItem('lapsedModalDismissed', 'true');
  };

  const handleDismiss = () => {
    sessionStorage.setItem('lapsedModalDismissed', 'true');
    onClose();
  };

  // Fetch last payment info when modal opens
  useEffect(() => {
    if (isOpen) {
      setPaymentLoading(true);
      fetch('/api/billing/last-payment', {
        credentials: 'include'
      })
        .then(res => res.json())
        .then(data => {
          if (data.amount && data.date) {
            setLastPayment({
              amount: data.amount,
              date: new Date(data.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })
            });
          }
        })
        .catch(err => {
          console.error('Error fetching last payment:', err);
        })
        .finally(() => {
          setPaymentLoading(false);
        });
    }
  }, [isOpen]);

  const handlePlugItIn = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      // Create Stripe billing portal session to update payment method
      const response = await fetch('/api/billing/resume-subscription', {
        method: 'POST',
        credentials: 'include',  // Include cookies for authentication
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const serverMessage = await readErrorMessage(response, 'Resume subscription');
        handleError(serverMessage || 'Error resuming subscription. Please try again later.', 'resume-subscription', response.status);
        return;
      }

      const data = await response.json();

      if (data.url) {
        // Redirect to Stripe portal to update payment method
        window.location.href = data.url;
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (error) {
      console.error('Error resuming subscription:', error);
      handleError('Error resuming subscription. Please try again later.', 'resume-subscription');
    }
  };

  const handleUnplugged = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/billing/set-unplugged', {
        method: 'POST',
        credentials: 'include',  // Include cookies for authentication
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const serverMessage = await readErrorMessage(response, 'Set unplugged');
        handleError(serverMessage || 'Error switching to freebie mode. Please try again later.', 'set-unplugged', response.status);
        return;
      }

      const data = await response.json();

      if (data.success) {
        // Set sessionStorage flag so modal doesn't show again this session
        sessionStorage.setItem('lapsedModalDismissed', 'true');
        // Reload to show unplugged mode
        window.location.reload();
      } else {
        throw new Error('Failed to set unplugged mode');
      }
    } catch (error) {
      console.error('Error setting unplugged mode:', error);
      handleError('Error switching to freebie mode. Please try again later.', 'set-unplugged');
    }
  };

  if (!isOpen) return null;

  // Format lapse date for display
  const formattedLapseDate = lapseDate ? new Date(lapseDate).toLocaleDateString() : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={(e) => {
        // Prevent clicks on backdrop from closing modal or passing through
        e.stopPropagation();
      }}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gray-700 rounded-lg p-4 mb-6">
          <p className="text-white text-lg font-semibold mb-2">
            Caution, potential discomfort ahead: Money talk
          </p>
          {!paymentLoading && lastPayment && (
            <p className="text-gray-200 text-sm">
              Your last payment was ${lastPayment.amount} on {lastPayment.date}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="border rounded-lg p-4 bg-blue-50">
            <h3 className="font-semibold mb-2">Resume with a payment</h3>
            <p className="text-sm text-gray-700 mb-3">
              Add or update your payment method to get your goodies back.
              We're keeping all your routines, items, and chord charts saved in our database for another {daysUntil90} days
              (counting from when you paused, canceled, or missed a payment).
            </p>
            <button
              onClick={handlePlugItIn}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors disabled:bg-gray-400"
            >
              {loading ? 'Loading...' : 'Plug it in'}
            </button>
          </div>

          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-semibold mb-2">Go back to freebie mode</h3>
            <p className="text-sm text-gray-700 mb-3">
              Keep using your most recently active routine for free. We'll save all your other stuff
              in our DB for another {daysUntil90} days if you renew by then
              (counting from when you paused, canceled, or missed a payment).
            </p>
            <button
              onClick={handleUnplugged}
              disabled={loading}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors disabled:bg-gray-400"
            >
              {loading ? 'Loading...' : 'Unplugged'}
            </button>
          </div>

          {errorMessage && (
            <div className="border border-red-300 rounded-lg p-4 bg-red-50" role="alert">
              <p className="text-sm text-red-800 mb-3">{errorMessage}</p>
              <button
                onClick={handleDismiss}
                className="w-full bg-white hover:bg-gray-100 text-gray-800 font-semibold py-2 px-4 rounded border border-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
