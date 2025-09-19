// src/components/UploadOverlay.js
import React from 'react';
import { Backdrop, Box, CircularProgress, Typography } from '@mui/material';

export default function UploadOverlay({ open, text = "Uploading… Please don’t exit the app." }) {
  return (
    <Backdrop open={open} sx={{ zIndex: 2000, color: '#fff' }}>
      <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5 }}>
        <CircularProgress />
        <Typography sx={{ fontWeight: 600 }}>{text}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          This window will close when upload is finished.
        </Typography>
      </Box>
    </Backdrop>
  );
}
