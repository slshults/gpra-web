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

  useEffect(() => {
    // Fetch current API key status
    fetchApiKeyStatus();
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

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6 text-gray-100">Account Settings</h1>

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
