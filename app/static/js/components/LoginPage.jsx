import React, { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

const RECAPTCHA_LOGIN_SITE_KEY = '6LcaNhssAAAAABV70hE2Sw6_CwxBQf3sf-1_xiMl';

const LoginPage = () => {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);

  useEffect(() => {
    // Check for password reset success message
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('password_reset') === 'success') {
      setSuccessMessage('Password reset successful! You can now log in with your new password.');
    }
  }, []);

  useEffect(() => {
    const loadRecaptchaScript = () => {
      if (window.grecaptcha?.enterprise) {
        setRecaptchaLoaded(true);
        return;
      }

      const existingScript = document.querySelector('script[src*="recaptcha/enterprise.js"]');
      if (existingScript) return;

      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_LOGIN_SITE_KEY}`;
      script.async = true;
      script.defer = true;
      script.onload = () => setRecaptchaLoaded(true);
      document.head.appendChild(script);
    };

    // Load after consent or immediately if already consented
    const consent = localStorage.getItem('cookieConsent');
    if (consent === 'all') {
      loadRecaptchaScript();
    }

    // Also load on first form interaction
    const handleInteraction = () => loadRecaptchaScript();
    const form = document.querySelector('form');
    form?.addEventListener('focus', handleInteraction, { once: true, capture: true });

    return () => form?.removeEventListener('focus', handleInteraction, { capture: true });
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!emailOrUsername.trim() || !password.trim()) {
      setError('Please enter both email/username and password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get reCAPTCHA token
      let recaptchaToken = '';
      if (window.grecaptcha?.enterprise) {
        recaptchaToken = await window.grecaptcha.enterprise.execute(
          RECAPTCHA_LOGIN_SITE_KEY,
          { action: 'login' }
        );
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrUsername,
          password,
          recaptcha_token: recaptchaToken
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Identify user with PostHog after successful login
        try {
          const authResponse = await fetch('/api/auth/status');
          const authData = await authResponse.json();

          if (authData.authenticated && window.posthog) {
            // Use posthog_distinct_id (email or tidalNNNNN) to coordinate with backend
            window.posthog.identify(authData.posthog_distinct_id, {
              email: authData.email,
              username: authData.user,
              subscription_tier: authData.tier,
              billing_period: authData.billing_period,
              oauth_providers: authData.oauth_providers || []
            });
          }
        } catch (err) {
          console.error('Failed to identify user with PostHog:', err);
        }

        // Check for saved hash from before login redirect (e.g., user was trying to access /#Account)
        const savedHash = sessionStorage.getItem('gpra_login_redirect_hash');
        if (savedHash) {
          sessionStorage.removeItem('gpra_login_redirect_hash');
          // Redirect to main app with the preserved hash
          window.location.href = '/' + savedHash;
        } else {
          // Redirect to main app on success
          window.location.href = '/';
        }
      } else {
        setError(data.error || 'Invalid email or password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* App Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500 mb-2" style={{lineHeight: '1.2'}}>
            <span className="whitespace-nowrap">Guitar Practice</span>
            {' '}
            <span className="whitespace-nowrap">Routine App</span>
          </h1>
        </div>

        {/* Login Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-100">Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Success Alert */}
              {successMessage && (
                <Alert className="bg-green-900/30 border-green-700">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <AlertDescription className="text-gray-300">{successMessage}</AlertDescription>
                </Alert>
              )}

              {/* Error Alert */}
              {error && (
                <Alert className="bg-red-900/30 border-red-700">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-gray-300">{error}</AlertDescription>
                </Alert>
              )}

              {/* OAuth Buttons */}
              <div className="space-y-3">
                <a href="/login/google" className="block">
                  <Button
                    type="button"
                    className="w-full bg-white hover:bg-gray-100 text-gray-900 border border-gray-300"
                    disabled={loading}
                  >
                    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Sign in with Google
                  </Button>
                </a>
                <a href="/login/tidal" className="block">
                  <Button
                    type="button"
                    className="w-full bg-black hover:bg-gray-900 text-white border border-gray-700"
                    disabled={loading}
                  >
                    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0L8 4L12 8L16 4L12 0Z"/>
                      <path d="M12 8L8 12L12 16L16 12L12 8Z"/>
                      <path d="M4 8L0 12L4 16L8 12L4 8Z"/>
                      <path d="M20 8L16 12L20 16L24 12L20 8Z"/>
                      <path d="M12 16L8 20L12 24L16 20L12 16Z"/>
                    </svg>
                    Sign in with Tidal
                  </Button>
                </a>
              </div>

              {/* OAuth Separator */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-600"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-800 text-gray-400">Or</span>
                </div>
              </div>

              {/* Email or Username Input */}
              <div className="space-y-2">
                <Label htmlFor="emailOrUsername" className="text-gray-200">Email or Username</Label>
                <Input
                  id="emailOrUsername"
                  type="text"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  placeholder="you@example.com or username"
                  className="bg-gray-900 border-gray-600 text-gray-100"
                  disabled={loading}
                  required
                />
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 z-10"
                    disabled={loading}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Login Button */}
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </Button>

              {/* Forgot Password Link */}
              <div className="text-center">
                <a
                  href={`/forgot-password${emailOrUsername ? `?email=${encodeURIComponent(emailOrUsername)}` : ''}`}
                  className="text-xs text-gray-500 hover:text-gray-200"
                >
                  Forgot password
                </a>
              </div>

              {/* Register Link */}
              <div className="text-center text-sm text-gray-400 mt-6">
                Don't have an account?{' '}
                <a href="/register" className="text-orange-500 hover:text-orange-400 font-medium">
                  Sign up
                </a>
                <div className="text-xs text-gray-500 mt-1">
                  (No card needed for 1 free routine)
                </div>
              </div>

              {/* reCAPTCHA Privacy Notice */}
              <p className="text-xs text-gray-500 mt-4 text-center">
                Site protected by reCAPTCHA, to which the Google{' '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                  Privacy Policy
                </a>{' '}
                and{' '}
                <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">
                  Terms of Service
                </a>{' '}
                apply.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
