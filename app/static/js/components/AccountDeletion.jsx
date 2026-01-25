import React, { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog';
import { Loader2, AlertTriangle, Download, X } from 'lucide-react';

/**
 * Account Deletion Component
 *
 * Sophisticated deletion flow with 3 options:
 * 1. Keep account (cancel deletion)
 * 2. Schedule deletion for renewal date (prorated refund)
 * 3. Delete immediately (no refund)
 *
 * Each deletion path requires typed confirmation phrase and email validation.
 */
const AccountDeletion = ({ userTier, unpluggedMode }) => {
  const [state, setState] = useState('initial'); // 'initial', 'scheduled', 'immediate'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showDeletionConfirmModal, setShowDeletionConfirmModal] = useState(false);
  const [showPauseConfirmModal, setShowPauseConfirmModal] = useState(false);
  const [stripePortalUrl, setStripePortalUrl] = useState(null);

  // Refund calculation state
  const [renewalDate, setRenewalDate] = useState('');

  // Form state
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [email, setEmail] = useState('');
  const [hasDeletionScheduled, setHasDeletionScheduled] = useState(false);
  const [isUnplugged, setIsUnplugged] = useState(unpluggedMode || false);

  const isFree = userTier === 'free';

  useEffect(() => {
    // Fetch refund calculation and deletion status
    if (!isFree) {
      fetchRefundCalculation();
    }
    checkDeletionStatus();
  }, [isFree]);

  useEffect(() => {
    // Sync unplugged state with prop
    setIsUnplugged(unpluggedMode || false);
  }, [unpluggedMode]);

  const checkDeletionStatus = async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const data = await response.json();
        setHasDeletionScheduled(!!data.deletion_scheduled_for);
      }
    } catch (error) {
      console.error('Error checking deletion status:', error);
    }
  };

  const fetchRefundCalculation = async () => {
    try {
      const response = await fetch('/api/user/calculate-deletion-refund');
      if (response.ok) {
        const data = await response.json();
        setRenewalDate(data.renewal_date);
      }
    } catch (err) {
      console.error('Error fetching refund calculation:', err);
    }
  };

  const handleScheduledDeletion = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/delete-account-scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_phrase: confirmationPhrase,
          email: email
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: `Account deletion scheduled for ${data.deletion_date}. You can cancel this anytime before then.`
        });
        setState('initial');
        setConfirmationPhrase('');
        setEmail('');
        setHasDeletionScheduled(true);  // Update state
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to schedule deletion' });
      }
    } catch (err) {
      console.error('Error scheduling deletion:', err);
      setMessage({ type: 'error', text: 'Error scheduling deletion' });
    } finally {
      setLoading(false);
    }
  };

  const handleImmediateDeletion = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const endpoint = isFree ? '/api/user/delete-account-free' : '/api/user/delete-account-immediate';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_phrase: confirmationPhrase,
          email: email
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Show confirmation modal instead of auto-redirecting
        setStripePortalUrl(data.redirect_url || '/login');
        setShowDeletionConfirmModal(true);
        setConfirmationPhrase('');
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete account' });
      }
    } catch (err) {
      console.error('Error deleting account:', err);
      setMessage({ type: 'error', text: 'Error deleting account' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeletionConfirmOk = () => {
    // Redirect to Stripe portal (or login for free users)
    window.location.href = stripePortalUrl || '/login';
  };

  const downloadAllData = async () => {
    try {
      const response = await fetch('/api/user/export/all');
      if (!response.ok) {
        throw new Error('Failed to download data');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `gpra-export-${date}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading data:', error);
      setMessage({ type: 'error', text: 'Failed to download your data. Please try again.' });
    }
  };

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
        setMessage({ type: 'success', text: 'Deletion canceled successfully!' });
        setHasDeletionScheduled(false);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to cancel deletion' });
      }
    } catch (err) {
      console.error('Error canceling deletion:', err);
      setMessage({ type: 'error', text: 'Error canceling deletion' });
    } finally {
      setLoading(false);
    }
  };

  const handlePauseSubscription = async () => {
    setShowPauseConfirmModal(false);
    setLoading(true);
    setMessage(null);

    try {
      const endpoint = isUnplugged ? '/api/billing/unpause-subscription' : '/api/billing/set-unplugged';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: isUnplugged
            ? 'Subscription resumed! You now have access to all routines.'
            : 'Subscription paused. You can now use your most recently active routine for free.'
        });
        setIsUnplugged(!isUnplugged); // Toggle state
        // Reload to update UI
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setMessage({ type: 'error', text: data.error || `Failed to ${isUnplugged ? 'unpause' : 'pause'} subscription` });
      }
    } catch (err) {
      console.error(`Error ${isUnplugged ? 'unpausing' : 'pausing'} subscription:`, err);
      setMessage({ type: 'error', text: `Error ${isUnplugged ? 'unpausing' : 'pausing'} subscription` });
    } finally {
      setLoading(false);
    }
  };

  // Render state-specific content
  let content;

  if (state === 'initial') {
    content = (
      <Card className="bg-red-900/10 border-red-700">
        <CardHeader>
          <CardTitle className="text-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Danger zone
          </CardTitle>
          <CardDescription className="text-gray-400">
            Permanently delete your account and all associated data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Warning box */}
          <Alert className="bg-orange-900/30 border-orange-700">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            <AlertDescription className="text-gray-300">
              <strong>Warning:</strong> Deleting your account will permanently remove:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>All practice items and routines</li>
                <li>All chord charts</li>
                <li>Practice history (last 90 days)</li>
                <li>Account settings and preferences</li>
              </ul>
              <p className="mt-2">
                <strong>This action cannot be undone.</strong>
              </p>
            </AlertDescription>
          </Alert>

          {/* Download data button */}
          <div className="flex items-center justify-between bg-blue-900/20 border border-blue-700 rounded-md p-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Download your data first</h3>
              <p className="text-xs text-gray-400">Your items, routines, chord charts, and practice history</p>
            </div>
            <Button
              onClick={downloadAllData}
              variant="outline"
              size="sm"
              className="border-blue-600 text-blue-400 hover:bg-blue-900/40"
            >
              <Download className="w-4 h-4 mr-2" />
              Download all your data
            </Button>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            {/* "Keep my account" button - only show if deletion is scheduled */}
            {hasDeletionScheduled && (
              <Button
                onClick={handleCancelDeletion}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {loading ? 'Canceling...' : 'Keep my account'}
              </Button>
            )}

            {/* "Pause subscription" or "Unpause" button - only show if deletion NOT scheduled */}
            {!hasDeletionScheduled && !isFree && (
              <Button
                onClick={() => setShowPauseConfirmModal(true)}
                disabled={loading}
                variant="outline"
                className={`w-full h-auto py-5 px-4 flex flex-col items-center gap-2 ${
                  isUnplugged
                    ? 'border-green-600 text-green-400 hover:bg-green-900/40'
                    : 'border-orange-600 text-orange-400 hover:bg-orange-900/40'
                }`}
              >
                {loading ? (
                  isUnplugged ? 'Unpausing...' : 'Pausing...'
                ) : isUnplugged ? (
                  <span className="font-semibold">Unpause</span>
                ) : (
                  <>
                    <span className="font-semibold">Pause subscription when it expires</span>
                    <span className="text-xs font-normal leading-normal text-center whitespace-normal max-w-full">
                      Keep using your most recently active routine for free when your paid subscription ends. <br/> We'll save your other routines for 90 days in case you renew.
                    </span>
                  </>
                )}
              </Button>
            )}

            {!isFree && (
              <Button
                onClick={() => setState('scheduled')}
                variant="outline"
                className="w-full border-orange-600 text-orange-400 hover:bg-orange-900/40"
              >
                Delete account after current paid subscription ends on {renewalDate}
              </Button>
            )}

            <Button
              onClick={() => setState('immediate')}
              variant="destructive"
              className="w-full bg-red-900 hover:bg-red-800"
            >
              Delete my account now! {!isFree && '(No refund)'}
            </Button>
          </div>

          {/* Message display */}
          {message && (
            <Alert className={message.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
              <AlertDescription className="text-gray-300">{message.text}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  } else if (state === 'scheduled') {
    const expectedPhrase = "If I delete it I cannot get it back";
    const phraseMatches = confirmationPhrase === expectedPhrase;

    content = (
      <Card className="bg-orange-900/10 border-orange-700">
        <CardHeader>
          <CardTitle className="text-gray-100">Schedule account deletion</CardTitle>
          <CardDescription className="text-gray-400">
            Delete your account on your next renewal date
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Info box */}
          <Alert className="bg-blue-900/30 border-blue-700">
            <AlertDescription className="text-gray-300">
              <p className="font-semibold mb-2">Here's what will happen:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your subscription will be canceled</li>
                <li>Your account will stay active until <strong>{renewalDate}</strong></li>
                <li>On {renewalDate}, all your data will be permanently deleted</li>
                <li>You can cancel this deletion anytime before {renewalDate}</li>
              </ul>
              <p className="mt-2 text-sm font-semibold text-orange-300">
                Note: You're paying to use the service until {renewalDate}, so no refunds.
              </p>
            </AlertDescription>
          </Alert>

          {/* Typed confirmation */}
          <div className="space-y-2">
            <Label htmlFor="confirm-scheduled" className="text-gray-200">
              Type the following phrase to confirm:
            </Label>
            <p className="text-sm font-mono bg-gray-800 border border-gray-700 rounded p-2 text-gray-300">
              {expectedPhrase}
            </p>
            <Input
              id="confirm-scheduled"
              value={confirmationPhrase}
              onChange={(e) => setConfirmationPhrase(e.target.value)}
              placeholder="Type the phrase exactly as shown"
              className={`bg-gray-900 border-gray-600 text-gray-100 ${
                confirmationPhrase.length > 0 && (phraseMatches ? 'border-green-500' : 'border-red-500')
              }`}
              disabled={loading}
            />
            {confirmationPhrase.length >= expectedPhrase.length && !phraseMatches && (
              <p className="text-xs text-red-400">Phrase does not match (case-sensitive)</p>
            )}
          </div>

          {/* Email confirmation */}
          <div className="space-y-2">
            <Label htmlFor="email-scheduled" className="text-gray-200">
              Enter your email address to confirm:
            </Label>
            <Input
              id="email-scheduled"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="bg-gray-900 border-gray-600 text-gray-100"
              disabled={loading}
            />
            <p className="text-xs text-gray-500">Must match your account email</p>
          </div>

          {/* Message display */}
          {message && (
            <Alert className={message.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
              <AlertDescription className="text-gray-300">{message.text}</AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => {
                setState('initial');
                setConfirmationPhrase('');
                setEmail('');
                setMessage(null);
              }}
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={loading}
            >
              <X className="w-4 h-4 mr-2" />
              Nevermind. I'll stay for now
            </Button>
            <Button
              onClick={handleScheduledDeletion}
              disabled={!phraseMatches || !email || loading}
              className="flex-1 bg-orange-600 hover:bg-orange-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scheduling...
                </>
              ) : (
                'Confirm scheduled deletion'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else if (state === 'immediate') {
    const expectedPhrase = "If I delete now I cannot get my data or money back";
    const phraseMatches = confirmationPhrase === expectedPhrase;

    content = (
      <Card className="bg-red-900/10 border-red-700">
        <CardHeader>
          <CardTitle className="text-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Delete account immediately
          </CardTitle>
          <CardDescription className="text-gray-400">
            This action is immediate and permanent
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Severe warning box */}
          <Alert className="bg-red-900/40 border-red-700">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <AlertDescription className="text-gray-300">
              <p className="font-bold mb-2">⚠️ FINAL WARNING ⚠️</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>NO REFUND</strong> - You will not receive any money back</li>
                <li><strong>IMMEDIATE</strong> - Your account will be deleted right now</li>
                <li><strong>PERMANENT</strong> - All data will be permanently erased</li>
                <li><strong>NO RECOVERY</strong> - You cannot undo this action</li>
                <li><strong>CANNOT ACCESS GPRA AGAIN</strong> - You'll need to create a new account</li>
                <li><strong>YOU WILL BE FORGOTTEN</strong> - We won't keep your email address or IP address, or anything. Most of it will be deleted immediately, but some anonymous logs which can't be connected to you (without a warrant) will age out of the logs within 90 days</li>
              </ul>
              <p className="mt-2 text-sm font-semibold text-orange-300">
                In addition to no refunds, the remainder of your prepaid period will not be prorated back to you.
              </p>
            </AlertDescription>
          </Alert>

          {/* Typed confirmation */}
          <div className="space-y-2">
            <Label htmlFor="confirm-immediate" className="text-gray-200">
              Type the following phrase to confirm:
            </Label>
            <p className="text-sm font-mono bg-gray-800 border border-gray-700 rounded p-2 text-gray-300">
              {expectedPhrase}
            </p>
            <Input
              id="confirm-immediate"
              value={confirmationPhrase}
              onChange={(e) => setConfirmationPhrase(e.target.value)}
              onPaste={(e) => e.preventDefault()}  // Disable paste
              autoComplete="off"  // Disable autofill
              placeholder="Type the phrase exactly as shown (paste disabled)"
              className={`bg-gray-900 border-gray-600 text-gray-100 ${
                confirmationPhrase.length > 0 && (phraseMatches ? 'border-green-500' : 'border-red-500')
              }`}
              disabled={loading}
            />
            {confirmationPhrase.length >= expectedPhrase.length && !phraseMatches && (
              <p className="text-xs text-red-400">Phrase does not match (case-sensitive)</p>
            )}
          </div>

          {/* Email confirmation */}
          <div className="space-y-2">
            <Label htmlFor="email-immediate" className="text-gray-200">
              Enter your email address to confirm:
            </Label>
            <Input
              id="email-immediate"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="bg-gray-900 border-gray-600 text-gray-100"
              disabled={loading}
            />
            <p className="text-xs text-gray-500">
              Must match your account email. Will also be deleted when you click the red button.
            </p>
          </div>

          {/* Message display */}
          {message && (
            <Alert className={message.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
              <AlertDescription className="text-gray-300">{message.text}</AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => {
                setState('initial');
                setConfirmationPhrase('');
                setEmail('');
                setMessage(null);
              }}
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={loading}
            >
              <X className="w-4 h-4 mr-2" />
              Nevermind, I'll stay for now.
            </Button>
            <Button
              onClick={handleImmediateDeletion}
              disabled={!phraseMatches || !email || loading}
              variant="destructive"
              className="flex-1 bg-red-900 hover:bg-red-800"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete immediately - No refund'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Always render modal alongside content
  return (
    <>
      {content}

      {/* Pause/Unpause Confirmation Modal */}
      <Dialog open={showPauseConfirmModal} onOpenChange={setShowPauseConfirmModal}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100">
          <DialogHeader>
            <DialogTitle className="text-xl text-gray-100">
              {isUnplugged ? 'Resume subscription?' : 'Pause subscription?'}
            </DialogTitle>
            <DialogDescription className="text-gray-300 space-y-3 pt-4">
              {isUnplugged ? (
                <p>
                  Your subscription will resume and you'll be charged when your next billing period arrives.
                  You'll regain access to all your routines.
                </p>
              ) : (
                <>
                  <p>
                    When your paid period ends, you'll only have access to your most recently active routine.
                  </p>
                  <p>
                    Your other routines will be saved for 90 days in case you decide to come back.
                  </p>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 sm:gap-3">
            <Button
              onClick={() => setShowPauseConfirmModal(false)}
              variant="outline"
              className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePauseSubscription}
              className={`flex-1 ${
                isUnplugged
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-orange-600 hover:bg-orange-700'
              }`}
            >
              {isUnplugged ? 'Resume' : 'Pause'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deletion Confirmation Modal */}
      <Dialog open={showDeletionConfirmModal} onOpenChange={setShowDeletionConfirmModal}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100">
          <DialogHeader>
            <DialogTitle className="text-xl text-gray-100">Account deleted</DialogTitle>
            <DialogDescription className="text-gray-300 space-y-3 pt-4">
              {isFree ? (
                // Free tier users - simple message
                <>
                  <p>
                    Ok, done. We've deleted all your stuff.
                  </p>
                  <p>
                    Your account has been deleted. Click Ok to return to login.
                  </p>
                </>
              ) : (
                // Paid tier users - Stripe portal message
                <>
                  <p>
                    Ok, done. We've deleted all your stuff, and we've cancelled your subscription on Stripe so it won't charge your card again.
                  </p>
                  <p>
                    When you click "Ok", we'll send you to your Stripe portal, which will show you any saved cards and your past invoices. (Sadly, it won't show you confirmation of the cancelled subscription, it will just show you the absence of any subscriptions. 🤷 Please feel free to complain to Stripe about that. I have.)
                  </p>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={handleDeletionConfirmOk}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Ok
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AccountDeletion;
