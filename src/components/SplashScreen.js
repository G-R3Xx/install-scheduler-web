// src/components/SplashScreen.js
import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';

export default function SplashScreen() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)',
        color: 'white',
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          px: 4,
          py: 3,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.10)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.30)',
          display: 'grid',
          gap: 1.2,
          placeItems: 'center',
          minWidth: 260,
        }}
      >
        {/* Swap this block for an <img src="/company-logo.png" /> if you like */}
        <Box
          sx={{
            width: 80,
            height: 80,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.12)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            letterSpacing: 1,
            fontSize: 22,
          }}
        >
          IS
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
          Install Scheduler
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          Getting things ready…
        </Typography>

        <CircularProgress thickness={4} size={32} sx={{ color: 'rgba(255,255,255,0.9)', mt: 1 }} />
      </Box>
    </Box>
  );
}
