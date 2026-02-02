import React, { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [oauthAccount, setOauthAccount] = useState(false);

  // Prefill email from URL parameter if present
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam));
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
      } else if (data.oauth_account) {
        // OAuth account detected - show Google sign-in button
        setOauthAccount(true);
      } else if (data.rate_limited) {
        // Rate limit exceeded
        setError(data.message);
      } else {
        setError(data.error || data.message || 'Failed to send reset link');
      }
    } catch (err) {
      console.error('Forgot password error:', err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success state - check your email
  if (success) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-800 border-gray-700">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
              <h2 className="text-2xl font-bold text-gray-100">Check Your Email</h2>
              <p className="text-gray-400">
                If an account exists with that email address, you'll receive password reset instructions shortly.
                <br /><br />
                (if it's not in your inbox, check the spam folder. Seriously though. Check the spam folder.)
              </p>
              <a href="/login" className="block">
                <Button className="bg-orange-600 hover:bg-orange-700 text-white mt-4">
                  Return to Login
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // OAuth account detected - show Google sign-in button
  if (oauthAccount) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* App Title */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-orange-500 mb-2">🎸 Guitar Practice Routine App</h1>
            <p className="text-gray-400">Sign in with Google</p>
          </div>

          {/* OAuth Account Card */}
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <AlertCircle className="h-16 w-16 text-blue-400 mx-auto" />
                <h2 className="text-2xl font-bold text-gray-100">OAuth Account</h2>
                <p className="text-gray-400">
                  It looks like you signed up with Google, so you don't have a password to reset. Use this button instead:
                </p>

                {/* Google Sign-In Button */}
                <a href="/login/google" className="block">
                  <Button className="w-full bg-white hover:bg-gray-100 text-gray-900 font-semibold flex items-center justify-center gap-3 py-6">
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                  </Button>
                </a>

                {/* Back to Login Link */}
                <div className="text-center text-sm text-gray-400 mt-6">
                  <a href="/login" className="text-orange-500 hover:text-orange-400 font-medium">
                    Back to Login
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* App Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500 mb-2">🎸 Guitar Practice Routine App</h1>
          <p className="text-gray-400">Reset your password</p>
        </div>

        {/* Forgot Password Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-100">Forgot Password</CardTitle>
            <CardDescription className="text-gray-400">
              Enter the email address you signed up with. We'll send you a link to reset your password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error Alert */}
              {error && (
                <Alert className="bg-red-900/30 border-red-700">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-gray-300">{error}</AlertDescription>
                </Alert>
              )}

              {/* Email Input */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-200">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-gray-900 border-gray-600 text-gray-100"
                  disabled={loading}
                  required
                />
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </Button>

              {/* Back to Login Link */}
              <div className="text-center text-sm text-gray-400 mt-6">
                Remember your password?{' '}
                <a href="/login" className="text-orange-500 hover:text-orange-400 font-medium">
                  Back to Login
                </a>
                <br />
                <span className="text-gray-500 text-xs">
                  Don't remember which email address you signed up with? Try them all.
                </span>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
