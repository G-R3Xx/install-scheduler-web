// src/theme.js
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: 'transparent',                 // let the gradient show through
      paper: 'rgba(255,255,255,0.06)',        // frosted glass fallback
    },
    text: {
      primary: '#ffffff',                     // ✅ white text by default
      secondary: 'rgba(255,255,255,0.78)',
      disabled: 'rgba(255,255,255,0.55)',
    },
  },
  typography: {
    allVariants: {
      color: '#ffffff',                       // ✅ ensure Typography defaults to white
    },
  },
  components: {
    // Global gradient + base text color
    MuiCssBaseline: {
      styleOverrides: `
        html, body, #root { height: 100%; }
        body {
          background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
          background-attachment: fixed;
          background-size: cover;
          color: #fff;
          margin: 0;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        /* Slight dark overlay under app for contrast */
        #root { background-color: rgba(0,0,0,0.28); }
      `,
    },

    // Frosted glass
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
          color: '#fff',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 16 },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'rgba(255,255,255,0.12)' },
      },
    },

    // Buttons readable on dark bg
    MuiButton: {
      styleOverrides: {
        root: { color: '#fff' },
        contained: {
          color: '#fff',
        },
        outlined: {
          borderColor: 'rgba(255,255,255,0.35)',
          color: '#fff',
          '&:hover': {
            borderColor: 'rgba(255,255,255,0.55)',
            backgroundColor: 'rgba(255,255,255,0.06)',
          },
        },
      },
    },

    // Inputs & labels readable on dark glass
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.25)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.45)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.65)',
          },
        },
        input: { color: '#fff' },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        root: { color: 'rgba(255,255,255,0.85)' },
      },
    },

    // Lists & secondary text
    MuiListItemText: {
      styleOverrides: {
        secondary: { color: 'rgba(255,255,255,0.78)' },
      },
    },

    // Chips visible on dark backgrounds
    MuiChip: {
      styleOverrides: {
        root: {
          color: '#fff',
          backgroundColor: 'rgba(255,255,255,0.10)',
          '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.8)' },
        },
      },
    },

    // Links readable
    MuiLink: {
      styleOverrides: {
        root: { color: '#90caf9' },
      },
    },
  },
});

export default theme;
