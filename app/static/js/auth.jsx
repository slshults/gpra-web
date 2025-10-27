// app/static/js/auth.js
import '../css/input.css'
import React from 'react';
import ReactDOM from 'react-dom/client';
import LoginPage from '@components/LoginPage';
import RegisterPage from '@components/RegisterPage';
import ForgotPasswordPage from '@components/ForgotPasswordPage';
import ResetPasswordPage from '@components/ResetPasswordPage';

// Get page type from data attribute
const authRoot = document.getElementById('auth-root');
const page = authRoot?.getAttribute('data-page');

// Render appropriate page
let PageComponent;
switch (page) {
  case 'register':
    PageComponent = RegisterPage;
    break;
  case 'forgot-password':
    PageComponent = ForgotPasswordPage;
    break;
  case 'reset-password':
    PageComponent = ResetPasswordPage;
    break;
  default:
    PageComponent = LoginPage;
}

ReactDOM.createRoot(authRoot).render(
  <React.StrictMode>
    <PageComponent />
  </React.StrictMode>
);
