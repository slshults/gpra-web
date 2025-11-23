import React, { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
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
const AccountDeletion = ({ userTier }) => {
  const [state, setState] = useState('initial'); // 'initial', 'scheduled', 'immediate'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // Refund calculation state
  const [renewalDate, setRenewalDate] = useState('');
  const [refundAmount, setRefundAmount] = useState(0);
  const [daysRemaining, setDaysRemaining] = useState(0);

  // Form state
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [email, setEmail] = useState('');

  const isFree = userTier === 'free';

  useEffect(() => {
    // Fetch refund calculation if paid tier
    if (!isFree) {
      fetchRefundCalculation();
    }
  }, [isFree]);

  const fetchRefundCalculation = async () => {
    try {
      const response = await fetch('/api/user/calculate-deletion-refund');
      if (response.ok) {
        const data = await response.json();
        setRenewalDate(data.renewal_date);
        setRefundAmount(data.refund_amount);
        setDaysRemaining(data.days_remaining);
      }
    } catch (error) {
      console.error('Error fetching refund calculation:', error);
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
          text: `Account deletion scheduled for ${data.deletion_date}. You'll receive a refund of $${data.refund_amount}.`
        });
        setState('initial');
        setConfirmationPhrase('');
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to schedule deletion' });
      }
    } catch (error) {
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
        setMessage({
          type: 'success',
          text: 'Account deleted successfully. Redirecting to login...'
        });
        // Redirect to login after 2 seconds
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete account' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error deleting account' });
    } finally {
      setLoading(false);
    }
  };

  const downloadPracticeData = () => {
    window.open('/api/practice/download?format=csv', '_blank');
  };

  // Initial view with 3 buttons
  if (state === 'initial') {
    return (
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
              <p className="text-xs text-gray-400">Export your practice history before deletion</p>
            </div>
            <Button
              onClick={downloadPracticeData}
              variant="outline"
              size="sm"
              className="border-blue-600 text-blue-400 hover:bg-blue-900/40"
            >
              <Download className="w-4 h-4 mr-2" />
              Download (90 days)
            </Button>
          </div>

          {/* 3 action buttons */}
          <div className="space-y-3">
            <Button
              onClick={() => setState('initial')}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Keep my account
            </Button>

            {!isFree && (
              <Button
                onClick={() => setState('scheduled')}
                variant="outline"
                className="w-full border-orange-600 text-orange-400 hover:bg-orange-900/40"
              >
                Cancel subscription (Delete account on {renewalDate})
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
  }

  // Scheduled deletion form
  if (state === 'scheduled') {
    const expectedPhrase = "If I delete it I cannot get it back";
    const phraseMatches = confirmationPhrase === expectedPhrase;

    return (
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
                <li>You'll receive a prorated refund of <strong>${refundAmount}</strong></li>
                <li>Your account will stay active until <strong>{renewalDate}</strong></li>
                <li>On {renewalDate}, all your data will be permanently deleted</li>
                <li>You can cancel this deletion anytime before {renewalDate}</li>
              </ul>
              <p className="mt-2 text-xs">
                Refund will appear in your account within 5-10 business days.
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
            {confirmationPhrase.length > 0 && !phraseMatches && (
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
              variant="outline"
              className="flex-1 border-gray-600"
              disabled={loading}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
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
  }

  // Immediate deletion form
  if (state === 'immediate') {
    const expectedPhrase = "If I delete now I cannot get my data or money back";
    const phraseMatches = confirmationPhrase === expectedPhrase;

    return (
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
              </ul>
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
              placeholder="Type the phrase exactly as shown"
              className={`bg-gray-900 border-gray-600 text-gray-100 ${
                confirmationPhrase.length > 0 && (phraseMatches ? 'border-green-500' : 'border-red-500')
              }`}
              disabled={loading}
            />
            {confirmationPhrase.length > 0 && !phraseMatches && (
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
              variant="outline"
              className="flex-1 border-gray-600"
              disabled={loading}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
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

  return null;
};

export default AccountDeletion;
