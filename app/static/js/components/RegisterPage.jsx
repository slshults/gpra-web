import React, { useState } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const RegisterPage = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const validatePassword = () => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
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

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        // Redirect to login page after 2 seconds
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
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
              <h2 className="text-2xl font-bold text-gray-100">Account Created!</h2>
              <p className="text-gray-400">
                Your account has been successfully created.
                <br />
                Redirecting to login page...
              </p>
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
          <h1 className="text-3xl font-bold text-orange-500 mb-2">Guitar Practice Routine App</h1>
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
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-gray-900 border-gray-600 text-gray-100"
                  disabled={loading}
                  required
                />
                <p className="text-xs text-gray-500">
                  Must be 8+ characters with uppercase, lowercase, and number
                </p>
              </div>

              {/* Confirm Password Input */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-200">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-gray-900 border-gray-600 text-gray-100"
                  disabled={loading}
                  required
                />
              </div>

              {/* Register Button */}
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading}
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
              <div className="text-center text-sm text-gray-400 mt-4">
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
