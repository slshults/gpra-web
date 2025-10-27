import React, { useState, useEffect } from 'react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Label } from '@ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ui/card';
import { Alert, AlertDescription } from '@ui/alert';
import { Loader2, Check, X, Eye, EyeOff, Trash2, ExternalLink, Play } from 'lucide-react';

const AccountSettings = () => {
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyUpdatedAt, setKeyUpdatedAt] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState(null);
  const [isValid, setIsValid] = useState(null);
  const [userProfile, setUserProfile] = useState({ username: '', email: '' });

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);

  useEffect(() => {
    // Fetch current API key status and user profile
    fetchApiKeyStatus();
    fetchUserProfile();
  }, []);

  const fetchApiKeyStatus = async () => {
    try {
      const response = await fetch('/api/user/api-key');
      if (response.ok) {
        const data = await response.json();
        setHasExistingKey(data.has_key);
        setKeyUpdatedAt(data.updated_at);
      }
    } catch (error) {
      console.error('Error fetching API key status:', error);
    }
  };

  const fetchUserProfile = async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const data = await response.json();
        setUserProfile({
          username: data.user || '',
          email: data.email || ''
        });
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  };

  const getGravatarUrl = (email, size = 128) => {
    // Create MD5 hash of email for Gravatar
    const trimmedEmail = (email || '').trim().toLowerCase();
    // Simple hash for gravatar - using a library would be better but keeping dependencies minimal
    // For now, we'll use a placeholder pattern. In production, you'd want crypto-js or similar
    const hash = Array.from(trimmedEmail).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0);
    return `https://www.gravatar.com/avatar/${Math.abs(hash).toString(16)}?s=${size}&d=identicon`;
  };

  const validateKey = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
      return;
    }

    setValidating(true);
    setMessage(null);
    setIsValid(null);

    try {
      const response = await fetch('/api/user/api-key/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });

      const data = await response.json();

      if (data.valid) {
        setIsValid(true);
        setMessage({ type: 'success', text: 'API key is valid!' });
      } else {
        setIsValid(false);
        setMessage({ type: 'error', text: data.error || 'Invalid API key' });
      }
    } catch (error) {
      setIsValid(false);
      setMessage({ type: 'error', text: 'Error validating API key' });
    } finally {
      setValidating(false);
    }
  };

  const saveKey = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'API key saved successfully!' });
        setHasExistingKey(true);
        setApiKey('');
        setShowKey(false);
        setIsValid(null);
        await fetchApiKeyStatus();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save API key' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error saving API key' });
    } finally {
      setLoading(false);
    }
  };

  const deleteKey = async () => {
    if (!confirm('Are you sure you want to delete your API key? You will need to enter it again to use autocreate.')) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/api-key', {
        method: 'DELETE',
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'API key deleted successfully' });
        setHasExistingKey(false);
        setKeyUpdatedAt(null);
        setApiKey('');
        setIsValid(null);
      } else {
        setMessage({ type: 'error', text: 'Failed to delete API key' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error deleting API key' });
    } finally {
      setLoading(false);
    }
  };

  const restartTour = async () => {
    try {
      // Reset tour status via API
      await fetch('/api/user/preferences/tour-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      // Reload page with tour param to start it
      window.location.href = '/?show_tour=1';
    } catch (error) {
      console.error('Error restarting tour:', error);
      // Fallback: just navigate with param
      window.location.href = '/?show_tour=1';
    }
  };

  const validatePasswordStrength = (password) => {
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

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordMessage(null);

    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'All fields are required' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    // Validate password strength
    const validationError = validatePasswordStrength(newPassword);
    if (validationError) {
      setPasswordMessage({ type: 'error', text: validationError });
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/user/password-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setPasswordMessage({ type: 'success', text: 'Password changed successfully!' });
        // Clear fields
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch (error) {
      setPasswordMessage({ type: 'error', text: 'Error changing password' });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6 text-gray-100">Account Settings</h1>

      {/* Profile Section */}
      <Card className="bg-gray-800 border-gray-700 mb-6">
        <CardHeader>
          <CardTitle className="text-gray-100">Profile</CardTitle>
          <CardDescription className="text-gray-400">
            Your account information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <img
              src={getGravatarUrl(userProfile.email)}
              alt="Profile avatar"
              className="w-20 h-20 rounded-full border-2 border-gray-600"
            />
            <div className="space-y-2">
              <div>
                <Label className="text-gray-400 text-sm">Username</Label>
                <p className="text-gray-100 font-medium">{userProfile.username || 'Loading...'}</p>
              </div>
              <div>
                <Label className="text-gray-400 text-sm">Email</Label>
                <p className="text-gray-100 font-medium">{userProfile.email || 'Loading...'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Section */}
      <Card className="bg-gray-800 border-gray-700 mb-6">
        <CardHeader>
          <CardTitle className="text-gray-100">Change Password</CardTitle>
          <CardDescription className="text-gray-400">
            Update your account password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-gray-200">
                Current Password
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPasswords.current ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  disabled={passwordLoading}
                >
                  {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-gray-200">
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPasswords.new ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  disabled={passwordLoading}
                >
                  {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-gray-200">
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  disabled={passwordLoading}
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

            {/* Messages */}
            {passwordMessage && (
              <Alert className={passwordMessage.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
                {passwordMessage.type === 'success' ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <X className="h-4 w-4 text-red-400" />
                )}
                <AlertDescription className="text-gray-300">{passwordMessage.text}</AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {passwordLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Changing Password...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Change Password
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-100">Anthropic API Key</CardTitle>
          <CardDescription className="text-gray-400">
            Manage your personal Anthropic API key for autocreate chord charts feature.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Info about API keys */}
          <div className="bg-blue-900/30 border border-blue-700 rounded-md p-4">
            <h3 className="text-sm font-semibold text-blue-300 mb-2">About API Keys</h3>
            <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
              <li><strong>Free/Basic tiers:</strong> Provide your own key to unlock autocreate</li>
              <li><strong>Standard+ tiers:</strong> Optionally use your own key to save costs</li>
              <li>Your key is encrypted and stored securely</li>
              <li>
                Get your API key from{' '}
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                >
                  Anthropic Console
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Current status */}
          {hasExistingKey && (
            <Alert className="bg-green-900/30 border-green-700">
              <Check className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-gray-300">
                API key configured
                {keyUpdatedAt && (
                  <span className="text-gray-400 ml-2">
                    (updated {new Date(keyUpdatedAt).toLocaleDateString()})
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* API Key input */}
          <div className="space-y-2">
            <Label htmlFor="api-key" className="text-gray-200">
              {hasExistingKey ? 'Update API Key' : 'Enter API Key'}
            </Label>
            <div className="flex gap-2" data-tour="api-key-input">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setIsValid(null);
                    setMessage(null);
                  }}
                  placeholder="sk-ant-api03-..."
                  className="bg-gray-900 border-gray-600 text-gray-100 pr-10"
                  disabled={loading || validating}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  disabled={loading || validating}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                onClick={validateKey}
                disabled={!apiKey.trim() || loading || validating}
                variant="outline"
                className="bg-gray-700 hover:bg-gray-600 border-gray-600"
              >
                {validating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              Your API key starts with "sk-ant-" and is about 100 characters long
            </p>
          </div>

          {/* Validation result */}
          {isValid !== null && (
            <Alert className={isValid ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
              {isValid ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <X className="h-4 w-4 text-red-400" />
              )}
              <AlertDescription className="text-gray-300">
                {isValid ? 'API key is valid!' : message?.text || 'Invalid API key'}
              </AlertDescription>
            </Alert>
          )}

          {/* General messages */}
          {message && isValid === null && (
            <Alert className={message.type === 'success' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}>
              {message.type === 'success' ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <X className="h-4 w-4 text-red-400" />
              )}
              <AlertDescription className="text-gray-300">{message.text}</AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={saveKey}
              disabled={!apiKey.trim() || loading || validating}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save API Key
                </>
              )}
            </Button>

            {hasExistingKey && (
              <Button
                onClick={deleteKey}
                disabled={loading}
                variant="destructive"
                className="bg-red-900 hover:bg-red-800"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Key
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700 mt-6">
        <CardHeader>
          <CardTitle className="text-gray-100">Guided Tour</CardTitle>
          <CardDescription className="text-gray-400">
            Take the interactive tour again to learn about GPRA features.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={restartTour}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Restart Tour
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountSettings;
