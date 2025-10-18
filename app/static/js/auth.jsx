// app/static/js/auth.js
import '../css/input.css'
import React from 'react';
import ReactDOM from 'react-dom/client';
import LoginPage from '@components/LoginPage';
import RegisterPage from '@components/RegisterPage';

// Get page type from data attribute
const authRoot = document.getElementById('auth-root');
const page = authRoot?.getAttribute('data-page');

// Render appropriate page
const PageComponent = page === 'register' ? RegisterPage : LoginPage;

ReactDOM.createRoot(authRoot).render(
  <React.StrictMode>
    <PageComponent />
  </React.StrictMode>
);
