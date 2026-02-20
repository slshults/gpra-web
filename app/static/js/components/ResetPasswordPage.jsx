import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { debugLog } from '@utils/logging';

const RECAPTCHA_SITE_KEY = '6LcjIvQrAAAAAM4psu6wJT3NlL8RIwH4tNiiAJ6C';

const ResetPasswordPage = () => {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ password: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recaptchaToken, setRecaptchaToken] = useState(null);
  const [recaptchaWidgetId, setRecaptchaWidgetId] = useState(null);
  const [recaptchaReady, setRecaptchaReady] = useState(false);
  const recaptchaRef = useRef(null);

  useEffect(() => {
    // Extract token from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');

    if (tokenParam) {
      setToken(tokenParam);
    } else {
      setError('Invalid or missing reset token');
    }
  }, []);

  // GDPR-compliant: Load reCAPTCHA only after consent
  useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (consent === 'all') {
      loadRecaptchaScript();
    }
  }, []);

  // Load reCAPTCHA when user shows intent to submit (GDPR-compliant)
  useEffect(() => {
    const hasFormActivity = password;
    const consent = localStorage.getItem('cookieConsent');

    if (hasFormActivity && consent === 'all') {
      loadRecaptchaScript();
    }
  }, [password]);

  // Render checkbox widget when script loads and container is ready
  useEffect(() => {
    if (recaptchaReady && window.grecaptcha?.enterprise && recaptchaRef.current && recaptchaWidgetId === null) {
      try {
        const widgetId = window.grecaptcha.enterprise.render(recaptchaRef.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback: (token) => setRecaptchaToken(token),
          'expired-callback': () => setRecaptchaToken(null),
          'error-callback': () => setRecaptchaToken(null),
          theme: 'dark'
        });
        setRecaptchaWidgetId(widgetId);
      } catch (e) {
        debugLog('reCAPTCHA', 'widget already rendered');
      }
    }
  }, [recaptchaReady, recaptchaWidgetId]);

  const loadRecaptchaScript = () => {
    if (window.grecaptcha?.enterprise) {
      setRecaptchaReady(true);
      return Promise.resolve();
    }

    if (document.querySelector('script[src*="recaptcha/enterprise.js"]')) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      window.onRecaptchaLoad = () => {
        setRecaptchaReady(true);
        resolve();
      };

      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/enterprise.js?onload=onRecaptchaLoad&render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    });
  };

  const resetRecaptcha = () => {
    setRecaptchaToken(null);
    if (window.grecaptcha?.enterprise && recaptchaWidgetId !== null) {
      try {
        window.grecaptcha.enterprise.reset(recaptchaWidgetId);
      } catch (e) {
        debugLog('reCAPTCHA', 'Could not reset widget');
      }
    }
  };

  const validatePassword = () => {
    if (password.length < 12) {
      return 'Password must be at least 12 characters long';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return 'Password must contain at least one symbol or punctuation character';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    const passwordError = validatePassword();
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (!recaptchaToken) {
      setError('Please complete the reCAPTCHA challenge');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, recaptcha_token: recaptchaToken }),
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to login with success message
        window.location.href = '/login?password_reset=success';
      } else {
        setError(data.error || 'Failed to reset password. The token may be expired or invalid.');
        resetRecaptcha();
      }
    } catch (err) {
      console.error('Reset password error:', err);
      setError('An error occurred. Please try again.');
      resetRecaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* App Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500 mb-2">🎸 Guitar Practice Routine App</h1>
          <p className="text-gray-400">Create a new password</p>
        </div>

        {/* Reset Password Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-100">Reset Password</CardTitle>
            <CardDescription className="text-gray-400">
              Enter your new password below
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

              {/* New Password Input */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">New Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPasswords.password ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                    disabled={loading || !token}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(prev => ({ ...prev, password: !prev.password }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    disabled={loading || !token}
                  >
                    {showPasswords.password ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password Input */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-200">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                    disabled={loading || !token}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    disabled={loading || !token}
                  >
                    {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Requirements */}
              <div className="bg-blue-900/30 border border-blue-700 rounded-md p-3">
                <h4 className="text-sm font-semibold text-blue-300 mb-1">Password Requirements:</h4>
                <ul className="text-xs text-gray-300 space-y-0.5 list-disc list-inside">
                  <li>At least 12 characters long</li>
                  <li>At least one uppercase letter</li>
                  <li>At least one lowercase letter</li>
                  <li>At least one number</li>
                  <li>At least one symbol or punctuation character</li>
                </ul>
              </div>

              {/* reCAPTCHA Enterprise Checkbox */}
              <div className="flex justify-center">
                <div ref={recaptchaRef}></div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading || !token}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting Password...
                  </>
                ) : (
                  'Reset Password'
                )}
              </Button>

              {/* reCAPTCHA Privacy Notice */}
              <p className="text-xs text-gray-500 text-center">
                Protected by reCAPTCHA.{' '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">Privacy</a>
                {' '}and{' '}
                <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">Terms</a>
                {' '}apply.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
