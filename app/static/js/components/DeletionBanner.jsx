import React, { useState } from 'react';
import { Button } from '@ui/button';
import { Alert, AlertDescription } from '@ui/alert';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

/**
 * DeletionBanner Component
 *
 * Displays a prominent warning banner when user has scheduled account deletion.
 * Shows deletion date, refund amount (if applicable), and option to cancel.
 */
const DeletionBanner = ({ deletionDate, deletionType, refundAmount, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [message, setMessage] = useState(null);

  const handleCancelDeletion = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/cancel-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Deletion canceled successfully! Page will reload...' });
        // Reload page to refresh auth status
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to cancel deletion' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error canceling deletion' });
    } finally {
      setLoading(false);
    }
  };

  // Don't show if dismissed
  if (dismissed) {
    return null;
  }

  // Format deletion date
  const formattedDate = new Date(deletionDate).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="bg-yellow-900/30 border-l-4 border-yellow-500 p-4 mb-4 rounded-r-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-yellow-100 font-semibold mb-1">
              Account deletion scheduled
            </h3>
            <p className="text-yellow-200 text-sm mb-2">
              Your account will be permanently deleted on <strong>{formattedDate}</strong>.
              {refundAmount > 0 && (
                <> You'll receive a refund of <strong>${refundAmount.toFixed(2)}</strong>.</>
              )}
            </p>
            {message && (
              <Alert className={`mt-2 ${message.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                <AlertDescription className="text-gray-300 text-xs">{message.text}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            onClick={handleCancelDeletion}
            disabled={loading}
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Canceling...
              </>
            ) : (
              'Cancel deletion'
            )}
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="text-yellow-400 hover:text-yellow-300 p-1"
            aria-label="Dismiss banner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeletionBanner;
