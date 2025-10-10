// components/AuthButton.jsx
import React from 'react';
import { Button } from '@ui/button';
import { useAuth } from '@hooks/useAuth';
import { Loader2, LogOut } from 'lucide-react';

const AuthButton = () => {
  const { isAuthenticated, hasSpreadsheetAccess, checking, error, handleLogin, handleLogout } = useAuth();

  return (
    <div className="ml-auto flex items-center gap-2">
      {isAuthenticated && !hasSpreadsheetAccess && (
        <span className="text-sm text-red-400">Log in with gmail acct instead</span>
      )}
      <Button 
        onClick={isAuthenticated ? handleLogout : handleLogin}
        variant={isAuthenticated ? "ghost" : "default"}
        className={isAuthenticated 
          ? "text-gray-400 hover:text-gray-200" 
          : "bg-blue-600 hover:bg-blue-700 text-gray-100"
        }
        disabled={checking}
      >
        {checking ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Checking auth...
          </>
        ) : error ? (
          "Auth Error - Click to retry"
        ) : isAuthenticated ? (
          "logout"
        ) : (
          <>
            <LogOut className="mr-2 h-4 w-4" />
            Let me in
          </>
        )}
      </Button>
    </div>
  );
};

export default AuthButton;

