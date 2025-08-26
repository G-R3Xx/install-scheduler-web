// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider, CssBaseline } from '@mui/material';
import './index.css'; // keep your global CSS (optional but recommended)
import theme from './theme';

const MIN_SPLASH_MS = 700; // 👈 adjust this to taste (e.g., 500–1000ms)
const startAt = performance.now();

function removeSplashWithDelay() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  const elapsed = performance.now() - startAt;
  const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

  // Wait so the splash shows at least MIN_SPLASH_MS
  setTimeout(() => {
    // optional fade-out
    splash.classList.add('fade-out');
    // remove after the CSS transition
    setTimeout(() => {
      if (splash && splash.parentNode) {
        splash.parentNode.removeChild(splash);
      }
    }, 220); // keep in sync with CSS transition duration
  }, remaining);
}

const root = ReactDOM.createRoot(document.getElementById('root'));

// Render first, then schedule splash removal (post-commit)
root.render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <AuthProvider>
      <App />
    </AuthProvider>
  </ThemeProvider>
);

// Ensure we wait at least one frame, then apply min delay logic
requestAnimationFrame(removeSplashWithDelay);
