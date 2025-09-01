import React from 'react';
import { Backdrop, Box, CircularProgress, Typography } from '@mui/material';

export default function BusyBackdrop({ open, text = "Working… please don't close this window" }) {
  return (
    <Backdrop
      open={!!open}
      sx={{
        zIndex: (theme) => theme.zIndex.modal + 5,
        color: '#fff',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <CircularProgress size={64} thickness={5} />
      <Box
        sx={{
          px: 2,
          py: 1,
          bgcolor: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 2,
        }}
      >
        <Typography variant="subtitle1" sx={{ textAlign: 'center' }}>
          {text}
        </Typography>
      </Box>
    </Backdrop>
  );
}
