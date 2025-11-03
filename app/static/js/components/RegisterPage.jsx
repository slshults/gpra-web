import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

const RECAPTCHA_SITE_KEY = '6LcjIvQrAAAAAM4psu6wJT3NlL8RIwH4tNiiAJ6C';

const RegisterPage = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false); // Single state for both password fields
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState(null);
  const recaptchaRef = useRef(null);

  // Password requirements validation
  const passwordRequirements = {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  };

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsDontMatch = confirmPassword.length > 0 && password !== confirmPassword;

  // Load reCAPTCHA script on component mount
  useEffect(() => {
    // Make callback available globally for reCAPTCHA
    window.onRecaptchaChange = (token) => {
      setRecaptchaToken(token);
    };

    const loadRecaptcha = () => {
      if (window.grecaptcha) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    };

    loadRecaptcha();

    // Cleanup
    return () => {
      delete window.onRecaptchaChange;
    };
  }, []);

  const resetRecaptcha = () => {
    // Reset the token state
    setRecaptchaToken(null);
    // Reset the widget if grecaptcha is loaded
    if (window.grecaptcha) {
      try {
        window.grecaptcha.reset();
      } catch (error) {
        console.error('Error resetting reCAPTCHA:', error);
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

  const handleRegister = async (e) => {
    e.preventDefault();

    // Validate inputs
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    if (!email.trim()) {
      setError('Please enter an email');
      return;
    }
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    // Validate password strength
    const passwordError = validatePassword();
    if (passwordError) {
      setError(passwordError);
      return;
    }

    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate reCAPTCHA
    if (!recaptchaToken) {
      setError('Please complete the reCAPTCHA verification');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, recaptcha_token: recaptchaToken }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        // Set flag to show tour after login
        sessionStorage.setItem('show_tour_after_login', 'true');
        // User will click "Let's go!" button to proceed
      } else {
        setError(data.error || 'Registration failed');
        resetRecaptcha();
      }
    } catch {
      setError('An error occurred. Please try again.');
      resetRecaptcha();
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-800 border-gray-700">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
              <h2 className="text-2xl font-bold text-gray-100">Welcome to GPRA!</h2>
              <p className="text-gray-400">
                You now have an account, and we've logged you in. Click that button to start the tour...
              </p>
              <Button
                onClick={() => window.location.href = '/'}
                className="bg-orange-600 hover:bg-orange-700 text-white mt-4"
              >
                Let's go!
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <p className="text-gray-400">Create your account</p>
        </div>

        {/* Register Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-100">Sign Up</CardTitle>
            <CardDescription className="text-gray-400">
              Enter your details to create a new account
            </CardDescription>
            <div className="text-xs text-gray-500 mt-2">
              (We won't spam you or sell your info to spammers.)
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
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
                    Sign up with Google
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
                    Sign up with Tidal
                  </Button>
                </a>
              </div>

              {/* OAuth Separator */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-600"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-800 text-gray-400">Or sign up with</span>
                </div>
              </div>

              {/* Username Input */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-gray-200">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="johndoe"
                  className="bg-gray-900 border-gray-600 text-gray-100"
                  disabled={loading}
                  required
                />
              </div>

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

              {/* Password Input */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPasswords ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 z-10"
                    disabled={loading}
                    tabIndex={-1}
                  >
                    {showPasswords ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Must be 12+ characters with uppercase, lowercase, number, and symbol
                </p>
              </div>

              {/* Confirm Password Input */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-200">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showPasswords ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 z-10"
                    disabled={loading}
                    tabIndex={-1}
                  >
                    {showPasswords ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>

                {/* Password Mismatch Indicator */}
                {passwordsDontMatch && (
                  <p className="text-xs text-red-400">
                    Passwords don't match
                  </p>
                )}

                {/* Password Requirements Checklist */}
                {password.length > 0 && (
                  <div className="text-xs space-y-1 mt-2">
                    <p className="text-gray-400 mb-1">Password requirements:</p>
                    <div className="space-y-0.5">
                      <div className={`flex items-center ${passwordRequirements.length ? 'text-green-400' : 'text-gray-500'}`}>
                        {passwordRequirements.length ? '✓' : '○'} At least 12 characters
                      </div>
                      <div className={`flex items-center ${passwordRequirements.uppercase ? 'text-green-400' : 'text-gray-500'}`}>
                        {passwordRequirements.uppercase ? '✓' : '○'} One uppercase letter
                      </div>
                      <div className={`flex items-center ${passwordRequirements.lowercase ? 'text-green-400' : 'text-gray-500'}`}>
                        {passwordRequirements.lowercase ? '✓' : '○'} One lowercase letter
                      </div>
                      <div className={`flex items-center ${passwordRequirements.number ? 'text-green-400' : 'text-gray-500'}`}>
                        {passwordRequirements.number ? '✓' : '○'} One number
                      </div>
                      <div className={`flex items-center ${passwordRequirements.symbol ? 'text-green-400' : 'text-gray-500'}`}>
                        {passwordRequirements.symbol ? '✓' : '○'} One symbol or punctuation
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* reCAPTCHA Widget */}
              <div className="flex justify-center">
                <div
                  className="g-recaptcha"
                  data-sitekey={RECAPTCHA_SITE_KEY}
                  data-callback="onRecaptchaChange"
                  data-theme="dark"
                  ref={recaptchaRef}
                ></div>
              </div>

              {/* Register Button */}
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading || !recaptchaToken}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </Button>

              {/* Login Link */}
              <div className="text-center text-sm text-gray-400 mt-6">
                Already have an account?{' '}
                <a href="/login" className="text-orange-500 hover:text-orange-400 font-medium">
                  Log in
                </a>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RegisterPage;
