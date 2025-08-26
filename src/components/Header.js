// src/components/Header.js
import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box
} from '@mui/material';
import { Link as RouterLink, useHistory } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Header() {
  const history = useHistory();
  const { currentUser, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      history.push('/login');
    } catch (e) {
      // no-op
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        // ✅ darker glass — not bright blue
        background: 'rgba(15, 23, 42, 0.65)', // slate-ish
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <Toolbar sx={{ minHeight: 56 }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 700, letterSpacing: 0.2 }}
          component={RouterLink}
          to="/"
          style={{ textDecoration: 'none', color: 'white' }}
        >
          Install Scheduler
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        <Button
          component={RouterLink}
          to="/"
          variant="text"
          sx={{ color: 'rgba(255,255,255,0.92)', mr: 1 }}
        >
          Jobs
        </Button>

        <Button
          component={RouterLink}
          to="/users"
          variant="text"
          sx={{ color: 'rgba(255,255,255,0.92)', mr: 1 }}
        >
          Manage Users
        </Button>

        {currentUser && (
          <Button
            onClick={handleLogout}
            variant="outlined"
            sx={{
              color: '#fff',
              borderColor: 'rgba(255,255,255,0.35)',
              '&:hover': {
                borderColor: 'rgba(255,255,255,0.55)',
                backgroundColor: 'rgba(255,255,255,0.06)',
              },
            }}
          >
            Log Out
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}
