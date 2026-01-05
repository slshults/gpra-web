import { useState, useEffect } from 'react';
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
import { Loader2, Check, X, Eye, EyeOff, Trash2, ExternalLink, Play, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import PricingSection from './PricingSection';
import AccountDeletion from './AccountDeletion';

const AccountSettings = () => {
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyUpdatedAt, setKeyUpdatedAt] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState(null);
  const [isValid, setIsValid] = useState(null);
  const [userProfile, setUserProfile] = useState({ username: '', email: '', tier: 'free', billing_period: null, oauth_providers: [], unplugged_mode: false });
  const [routineCount, setRoutineCount] = useState(0);
  const [routineLimit, setRoutineLimit] = useState(1);

  // Practice data download state
  const [showExpirationWarning, setShowExpirationWarning] = useState(false);
  const [expirationDays, setExpirationDays] = useState(0);
  const [downloadingData, setDownloadingData] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);

  // PostHog analytics state
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);

  // Username/email editing state
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState(null);
  const [emailMessage, setEmailMessage] = useState(null);

  // Mobile view toggle state
  const [mobileView, setMobileView] = useState('settings'); // 'settings' or 'subscription'

  // Collapsed cards state - load from sessionStorage or default to all collapsed
  // Merge with defaults so new keys (like dangerZone) default to collapsed
  const [collapsedCards, setCollapsedCards] = useState(() => {
    const defaults = {
      overview: true,
      apiKey: true,
      practiceData: true,
      changePassword: true,
      analytics: true,
      guidedTour: true,
      dangerZone: true
    };
    const saved = sessionStorage.getItem('accountSettingsCollapsed');
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });

  // Save collapsed state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem('accountSettingsCollapsed', JSON.stringify(collapsedCards));
  }, [collapsedCards]);

  useEffect(() => {
    // Fetch current API key status, user profile, routine count, and expiration warning
    fetchApiKeyStatus();
    fetchUserProfile();
    fetchRoutineCount();
    fetchExpirationWarning();

    // Check current consent status from localStorage AND actual cookie presence
    const cookieConsent = localStorage.getItem('cookieConsent');
    const hasPostHogCookies = document.cookie.split(';').some(cookie => {
      const name = cookie.trim().split('=')[0];
      return /^ph.*phc_/.test(name);
    });

    // Analytics enabled if user consented 'all' AND cookies exist
    setAnalyticsEnabled(cookieConsent === 'all' && hasPostHogCookies);
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
          email: data.email || '',
          tier: data.tier || 'free',
          billing_period: data.billing_period || null,
          oauth_providers: data.oauth_providers || [],
          unplugged_mode: data.unplugged_mode || false
        });

        // Set routine limit based on tier
        const tierLimits = {
          free: 1,
          basic: 5,
          thegoods: 10,
          moregoods: 25,
          themost: 50
        };
        setRoutineLimit(tierLimits[data.tier] || 1);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  };

  const fetchRoutineCount = async () => {
    try {
      const response = await fetch('/api/routines');
      if (response.ok) {
        const data = await response.json();
        setRoutineCount(Array.isArray(data) ? data.length : 0);
      }
    } catch (error) {
      console.error('Error fetching routine count:', error);
    }
  };

  // const getGravatarUrl = (email, size = 128) => {
  //   // Create MD5 hash of email for Gravatar
  //   const trimmedEmail = (email || '').trim().toLowerCase();
  //   // Simple hash for gravatar - using a library would be better but keeping dependencies minimal
  //   // For now, we'll use a placeholder pattern. In production, you'd want crypto-js or similar
  //   const hash = Array.from(trimmedEmail).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0);
  //   return `https://www.gravatar.com/avatar/${Math.abs(hash).toString(16)}?s=${size}&d=identicon`;
  // };

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
    } catch {
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
    } catch {
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
    } catch {
      setMessage({ type: 'error', text: 'Error deleting API key' });
    } finally {
      setLoading(false);
    }
  };

  // Practice data download handlers
  const fetchExpirationWarning = async () => {
    try {
      const response = await fetch('/api/user/practice-data/expiration-warning');
      const data = await response.json();
      if (data.has_expiring_data && data.days_until_expiration <= 7) {
        setShowExpirationWarning(true);
        setExpirationDays(data.days_until_expiration);
      }
    } catch (error) {
      console.error('Error fetching expiration warning:', error);
    }
  };

  const downloadPracticeData = async (format = 'csv') => {
    setDownloadingData(true);
    try {
      const response = await fetch(`/api/user/practice-data/download?format=${format}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `practice-data-${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      setShowExpirationWarning(false);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloadingData(false);
    }
  };

  const dismissReminder = async (days) => {
    try {
      await fetch('/api/user/practice-data/dismiss-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss_duration_days: days })
      });
      setShowExpirationWarning(false);
    } catch (error) {
      console.error('Error dismissing reminder:', error);
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
    if (password.length < 14) {
      return 'Password must be at least 14 characters long';
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
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>?]/.test(password)) {
      return 'Password must contain at least one symbol or punctuation character';
    }
    return null;
  };

  const getTierDisplayName = (tier) => {
    const names = {
      free: 'Free',
      basic: 'Basic',
      thegoods: 'The Goods',
      moregoods: 'More Goods',
      themost: 'The Most'
    };
    return names[tier] || 'Free';
  };

  const getTierBadgeColor = (tier) => {
    const colors = {
      free: 'bg-gray-600 text-gray-200',
      basic: 'bg-blue-600 text-blue-100',
      thegoods: 'bg-green-600 text-green-100',
      moregoods: 'bg-purple-600 text-purple-100',
      themost: 'bg-orange-600 text-orange-100'
    };
    return colors[tier] || colors.free;
  };

  const getUsageColor = (count, limit) => {
    if (limit === Infinity) return 'text-green-400';
    const percentage = (count / limit) * 100;
    if (percentage >= 100) return 'text-red-400';
    if (percentage >= 80) return 'text-yellow-400';
    return 'text-green-400';
  };

  const toggleCard = (cardName) => {
    setCollapsedCards(prev => ({
      ...prev,
      [cardName]: !prev[cardName]
    }));
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
    } catch {
      setPasswordMessage({ type: 'error', text: 'Error changing password' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const deleteCookies = (pattern) => {
    // Delete all cookies matching the pattern
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();

      if (pattern.test(name)) {
        // Delete cookie for all paths and domains
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname;
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname;
      }
    }
  };

  const toggleAnalytics = async () => {
    const newConsent = analyticsEnabled ? 'essential' : 'all';

    // Save to both localStorage (fast) and server session (cross-subdomain)
    localStorage.setItem('cookieConsent', newConsent);

    try {
      // Get CSRF token
      const tokenResponse = await fetch('/api/csrf-token');
      const { csrf_token } = await tokenResponse.json();

      // Save consent with CSRF protection
      await fetch('/api/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf_token
        },
        body: JSON.stringify({ consent: newConsent })
      });
    } catch (error) {
      console.error('[AccountSettings] Failed to save consent to server:', error);
    }

    if (analyticsEnabled) {
      // User wants to disable analytics - opt out and delete PostHog data
      if (typeof posthog !== 'undefined' && posthog.opt_out_capturing) {
        posthog.opt_out_capturing(); // Disables tracking and sets opt-out cookie
      }
      deleteCookies(/^ph_phc_/); // Remove PostHog cookies

      // Manually clear ALL PostHog localStorage (opt_out_capturing preserves distinct_id by design)
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('ph_') || key.includes('posthog')) {
          localStorage.removeItem(key);
        }
      });
    } else {
      // User wants to enable analytics - opt in
      if (typeof posthog !== 'undefined' && posthog.opt_in_capturing) {
        posthog.opt_in_capturing(); // Re-enables tracking
      }
    }

    // Reload page to load/unload PostHog SDK
    window.location.reload();
  };

  // Username editing handlers
  const startEditingUsername = () => {
    setEditUsername(userProfile.username);
    setIsEditingUsername(true);
    setUsernameMessage(null);
  };

  const cancelEditingUsername = () => {
    setIsEditingUsername(false);
    setEditUsername('');
    setUsernameMessage(null);
  };

  const saveUsername = async () => {
    const trimmedUsername = editUsername.trim();
    if (!trimmedUsername) {
      setUsernameMessage({ type: 'error', text: 'Username is required' });
      return;
    }
    if (trimmedUsername.length < 3) {
      setUsernameMessage({ type: 'error', text: 'Username must be at least 3 characters' });
      return;
    }
    if (trimmedUsername === userProfile.username) {
      setIsEditingUsername(false);
      return;
    }

    setUsernameLoading(true);
    setUsernameMessage(null);

    try {
      const response = await fetch('/api/user/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedUsername }),
      });

      const data = await response.json();

      if (response.ok) {
        setUserProfile(prev => ({ ...prev, username: data.username }));
        setIsEditingUsername(false);
        setUsernameMessage({ type: 'success', text: 'Username updated!' });
        // Clear success message after 3 seconds
        setTimeout(() => setUsernameMessage(null), 3000);
      } else {
        setUsernameMessage({ type: 'error', text: data.error || 'Failed to update username' });
      }
    } catch {
      setUsernameMessage({ type: 'error', text: 'Error updating username' });
    } finally {
      setUsernameLoading(false);
    }
  };

  // Email editing handlers
  const startEditingEmail = () => {
    setEditEmail(userProfile.email);
    setIsEditingEmail(true);
    setEmailMessage(null);
  };

  const cancelEditingEmail = () => {
    setIsEditingEmail(false);
    setEditEmail('');
    setEmailMessage(null);
  };

  const saveEmail = async () => {
    const trimmedEmail = editEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailMessage({ type: 'error', text: 'Email is required' });
      return;
    }
    // Basic email validation
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(trimmedEmail)) {
      setEmailMessage({ type: 'error', text: 'Please enter a valid email address' });
      return;
    }
    if (trimmedEmail === userProfile.email) {
      setIsEditingEmail(false);
      return;
    }

    setEmailLoading(true);
    setEmailMessage(null);

    try {
      const response = await fetch('/api/user/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setUserProfile(prev => ({ ...prev, email: data.email }));
        setIsEditingEmail(false);
        setEmailMessage({ type: 'success', text: 'Email updated!' });
        // Clear success message after 3 seconds
        setTimeout(() => setEmailMessage(null), 3000);
      } else {
        setEmailMessage({ type: 'error', text: data.error || 'Failed to update email' });
      }
    } catch {
      setEmailMessage({ type: 'error', text: 'Error updating email' });
    } finally {
      setEmailLoading(false);
    }
  };

  // Check if user can edit username/email based on OAuth providers
  const isTidalUser = userProfile.oauth_providers?.includes('tidal');
  const isGoogleUser = userProfile.oauth_providers?.includes('google');
  const canEditUsername = !isTidalUser;  // Tidal users can't edit username
  const canEditEmail = !isGoogleUser;     // Google users can't edit email

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6 text-gray-100">Account Settings</h1>

      {/* Mobile View Toggle - only visible on small screens */}
      <div className="flex gap-2 mb-4 md:hidden">
        <Button
          variant={mobileView === 'settings' ? 'default' : 'outline'}
          onClick={() => setMobileView('settings')}
          className={mobileView === 'settings' ? 'bg-orange-600' : 'bg-gray-700 border-gray-600'}
        >
          Settings
        </Button>
        <Button
          variant={mobileView === 'subscription' ? 'default' : 'outline'}
          onClick={() => setMobileView('subscription')}
          className={mobileView === 'subscription' ? 'bg-orange-600' : 'bg-gray-700 border-gray-600'}
        >
          Subscription
        </Button>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - Settings */}
        <div className={`space-y-6 md:block ${mobileView === 'settings' ? '' : 'hidden'}`}>
          {/* Overview Card - Collapsible, collapsed by default showing username and tier */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('overview')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-gray-100">{userProfile.username || 'Loading...'}</CardTitle>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getTierBadgeColor(userProfile.tier)}`}>
                    {getTierDisplayName(userProfile.tier)}
                  </span>
                  <span className={`text-sm font-medium ${getUsageColor(routineCount, routineLimit)}`}>
                    {routineCount} / {routineLimit === Infinity ? '∞' : routineLimit} routines
                  </span>
                </div>
                {collapsedCards.overview ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.overview && (
            <CardContent className="pt-0">
              <div className="flex items-start gap-6 flex-wrap">
                {/* Account Info - Username and Email */}
                <div className="flex-1 min-w-[200px] space-y-3">
                  {/* Username field */}
                  <div>
                    {isEditingUsername ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="bg-gray-900 border-gray-600 text-gray-100 text-lg font-bold h-9 max-w-[200px]"
                          placeholder="Username"
                          disabled={usernameLoading}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveUsername();
                            if (e.key === 'Escape') cancelEditingUsername();
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={saveUsername}
                          disabled={usernameLoading}
                          className="bg-green-600 hover:bg-green-700 h-8 px-2"
                        >
                          {usernameLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEditingUsername}
                          disabled={usernameLoading}
                          className="bg-gray-700 border-gray-600 h-8 px-2"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-gray-100">{userProfile.username || 'Loading...'}</h2>
                        {canEditUsername && (
                          <button
                            onClick={startEditingUsername}
                            className="text-gray-400 hover:text-gray-200 p-1"
                            title="Edit username"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                    {!canEditUsername && !isEditingUsername && (
                      <p className="text-xs text-gray-500 mt-1">
                        You log in with your Tidal account, so you can't change your username here.
                      </p>
                    )}
                    {usernameMessage && (
                      <p className={`text-xs mt-1 ${usernameMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        {usernameMessage.text}
                      </p>
                    )}
                  </div>

                  {/* Email field */}
                  <div>
                    {isEditingEmail ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="bg-gray-900 border-gray-600 text-gray-100 text-sm h-8 max-w-[250px]"
                          placeholder="Email"
                          disabled={emailLoading}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEmail();
                            if (e.key === 'Escape') cancelEditingEmail();
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={saveEmail}
                          disabled={emailLoading}
                          className="bg-green-600 hover:bg-green-700 h-8 px-2"
                        >
                          {emailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEditingEmail}
                          disabled={emailLoading}
                          className="bg-gray-700 border-gray-600 h-8 px-2"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-400">{userProfile.email || 'Loading...'}</p>
                        {canEditEmail && (
                          <button
                            onClick={startEditingEmail}
                            className="text-gray-400 hover:text-gray-200 p-1"
                            title="Edit email"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                    {!canEditEmail && !isEditingEmail && (
                      <p className="text-xs text-gray-500 mt-1">
                        You log in with your Google account, so you can't change your email address here.
                      </p>
                    )}
                    {isTidalUser && canEditEmail && !isEditingEmail && (
                      <p className="text-xs text-gray-500 mt-1">
                        Add your real email address to get reminders if you haven't used the account for 90 days.
                      </p>
                    )}
                    {emailMessage && (
                      <p className={`text-xs mt-1 ${emailMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        {emailMessage.text}
                      </p>
                    )}
                  </div>

                  {/* OAuth badges - only show Tidal badge (Google badge removed per Issue 1 to avoid confusion) */}
                  {userProfile.oauth_providers && userProfile.oauth_providers.includes('tidal') && (
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded border border-gray-600">
                        <img
                          src="/static/images/tidal-logo.png"
                          alt="Tidal"
                          className="w-4 h-4 rounded"
                        />
                        Tidal
                      </span>
                    </div>
                  )}
                </div>

              </div>
            </CardContent>
            )}
          </Card>

          {/* API Key Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('apiKey')}
              data-tour="api-key-card-header"
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-gray-100">Anthropic API key</CardTitle>
                </div>
                {collapsedCards.apiKey ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.apiKey && (
              <CardContent className="space-y-4">
                {/* Info about API keys */}
                <div className="bg-blue-900/30 border border-blue-700 rounded-md p-4">
                  <h3 className="text-sm font-semibold text-blue-300 mb-2">About API keys</h3>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                    <li><strong>Free/Basic tiers:</strong> Provide your own API key to autocreate chord charts</li>
                    <li><strong>The Goods+ tiers:</strong> Optional. Autocreated chord charts already included, but you can use your own key if you're hitting rate limits</li>
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
                    {hasExistingKey ? 'Update API key' : 'Paste API key'}
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
                <div className="flex gap-3">
                  <Button
                    onClick={saveKey}
                    disabled={!apiKey.trim() || loading || validating}
                    className="bg-orange-600 hover:bg-orange-700 flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Save API key
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
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Practice Data Download Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('practiceData')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-gray-100">Download practice history</CardTitle>
                  <CardDescription className="text-gray-400">
                    Download your practice history (last 90 days)
                  </CardDescription>
                </div>
                {collapsedCards.practiceData ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.practiceData && (
              <CardContent className="space-y-4">
                {/* Expiration Warning */}
                {showExpirationWarning && (
                  <Alert className="bg-orange-900/30 border-orange-700">
                    <AlertDescription className="text-gray-300">
                      You have practice data that will be deleted in {expirationDays} days. Download it to keep your records!
                      <div className="flex gap-2 mt-3 flex-wrap">
                        <Button onClick={() => downloadPracticeData('csv')} size="sm" className="bg-orange-600 hover:bg-orange-700">
                          Download now
                        </Button>
                        <Button onClick={() => dismissReminder(1)} variant="outline" size="sm" className="border-gray-600">
                          Remind me tomorrow
                        </Button>
                        <Button onClick={() => dismissReminder(90)} variant="outline" size="sm" className="border-gray-600">
                          Don't care
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Download Buttons */}
                <div className="flex gap-3 flex-col sm:flex-row">
                  <Button
                    onClick={() => downloadPracticeData('csv')}
                    disabled={downloadingData}
                    className="bg-orange-600 hover:bg-orange-700 flex-1"
                  >
                    {downloadingData ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Download CSV
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => downloadPracticeData('json')}
                    disabled={downloadingData}
                    variant="outline"
                    className="bg-gray-700 hover:bg-gray-600 border-gray-600 flex-1"
                  >
                    {downloadingData ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      'Download JSON'
                    )}
                  </Button>
                </div>

                {/* Info note */}
                <p className="text-xs text-gray-400">
                  Practice data is automatically deleted after 90 days. Download your data regularly to keep permanent records.
                </p>
              </CardContent>
            )}
          </Card>

          {/* Change Password Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('changePassword')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-gray-100">Change password</CardTitle>
                  <CardDescription className="text-gray-400">
                    Update your account password
                  </CardDescription>
                </div>
                {collapsedCards.changePassword ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.changePassword && (
              <CardContent>
                {/* Show note for OAuth users instead of password form */}
                {isGoogleUser || isTidalUser ? (
                  <p className="text-sm text-gray-400">
                    {isGoogleUser
                      ? 'You log in with Google, so you have no password here to change.'
                      : 'You log in with Tidal, so you have no password here to change.'}
                  </p>
                ) : (
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    {/* Current Password */}
                    <div className="space-y-2">
                      <Label htmlFor="current-password" className="text-gray-200">
                        Current password
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
                        New password
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
                        Confirm new password
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
                      <h4 className="text-sm font-semibold text-blue-300 mb-1">Password requirements:</h4>
                      <ul className="text-xs text-gray-300 space-y-0.5 list-disc list-inside">
                        <li>At least 14 characters long</li>
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
                      className="bg-orange-600 hover:bg-orange-700 w-full"
                    >
                      {passwordLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Changing password...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Change password
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </CardContent>
            )}
          </Card>

          {/* Analytics Privacy Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('analytics')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-gray-100">Analytics & privacy</CardTitle>
                  <CardDescription className="text-gray-400">
                    Control whether we can collect analytics
                  </CardDescription>
                </div>
                {collapsedCards.analytics ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.analytics && (
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-gray-200">Allow analytics tracking</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        analyticsEnabled ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                      }`}>
                        {analyticsEnabled ? 'Allowed' : 'Disallowed'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Help us improve GPRA by allowing usage analytics via PostHog cookies. (We'll never sell or share your data.)
                    </p>
                  </div>
                  <button
                    onClick={toggleAnalytics}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                      analyticsEnabled
                        ? 'bg-green-600 focus:ring-green-500'
                        : 'bg-red-600 focus:ring-red-500'
                    }`}
                    role="switch"
                    aria-checked={analyticsEnabled}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        analyticsEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                  <p>
                    Learn more about how we handle your data in our{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">
                      Privacy Policy
                    </a>
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Guided Tour Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('guidedTour')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-gray-100">Guided tour</CardTitle>
                  <CardDescription className="text-gray-400">
                    Take the intro tour again
                  </CardDescription>
                </div>
                {collapsedCards.guidedTour ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.guidedTour && (
              <CardContent>
                <Button
                  onClick={restartTour}
                  className="bg-orange-600 hover:bg-orange-700 w-full"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Restart tour
                </Button>
              </CardContent>
            )}
          </Card>

          {/* Danger Zone Card - Collapsible */}
          <Card className="bg-gray-800 border-gray-700 border-red-900/50">
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => toggleCard('dangerZone')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-red-400">Danger zone</CardTitle>
                  <CardDescription className="text-gray-400">
                    Pause your payments, or delete your account and all your data
                  </CardDescription>
                </div>
                {collapsedCards.dangerZone ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </CardHeader>
            {!collapsedCards.dangerZone && (
              <CardContent className="p-0">
                <AccountDeletion userTier={userProfile.tier} unpluggedMode={userProfile.unplugged_mode} />
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right Column - Subscription */}
        <div id="subscription-card" className={`space-y-6 md:block ${mobileView === 'subscription' ? '' : 'hidden'}`}>
          {/* Each tier card is now collapsible within PricingSection */}
          <PricingSection currentTier={userProfile.tier} currentBillingPeriod={userProfile.billing_period} />
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;
