// src/components/OhsPromptOnLoad.js
import React, { useEffect, useState, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, CircularProgress, Box
} from '@mui/material';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { useHistory, useLocation } from 'react-router-dom';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

const DISMISS_HOURS = 8;
const COMPLETED_HOURS = 24;

function withinHours(date, hours) {
  if (!date) return false;
  const now = Date.now();
  return now - date.getTime() <= hours * 60 * 60 * 1000;
}

function getQueryParam(search, key) {
  const params = new URLSearchParams(search || '');
  return params.get(key);
}

export default function OhsPromptOnLoad({ jobId, jobStatus }) {
  const history = useHistory();
  const location = useLocation();
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  const dismissKey = useMemo(() => `ohsPromptDismissed_${jobId}`, [jobId]);
  const completedKey = useMemo(() => `ohsCompleted_${jobId}`, [jobId]);

  useEffect(() => {
    let isMounted = true;

    async function checkShouldPrompt() {
      try {
        if (!jobId) {
          console.debug('[OHS] No jobId → no prompt');
          if (isMounted) { setChecking(false); setOpen(false); }
          return;
        }

        const status = (jobStatus || '').toString().toLowerCase();
        const isComplete = status.startsWith('complete'); // matches 'complete', 'completed'
        if (isComplete) {
          console.debug('[OHS] Job is complete → suppress prompt');
          if (isMounted) { setChecking(false); setOpen(false); }
          return;
        }

        // URL flags
        const ohsParam = getQueryParam(location.search, 'ohs');
        if (ohsParam === 'force') {
          console.debug('[OHS] Forced via ?ohs=force');
          // Clear any local suppressors for a clean test
          localStorage.removeItem(dismissKey);
          localStorage.removeItem(completedKey);
          if (isMounted) { setChecking(false); setOpen(true); }
          return;
        }
        if (ohsParam === 'completed') {
          console.debug('[OHS] Detected ?ohs=completed → suppress and clean URL');
          history.replace(location.pathname);
          if (isMounted) { setChecking(false); setOpen(false); }
          return;
        }

        // Local completion suppressor
        const completedAtRaw = localStorage.getItem(completedKey);
        if (completedAtRaw && withinHours(new Date(Number(completedAtRaw)), COMPLETED_HOURS)) {
          console.debug('[OHS] Local completed flag fresh → suppress prompt');
          if (isMounted) { setChecking(false); setOpen(false); }
          return;
        }

        // Local "not now" suppressor
        const dismissedAtRaw = localStorage.getItem(dismissKey);
        if (dismissedAtRaw && withinHours(new Date(Number(dismissedAtRaw)), DISMISS_HOURS)) {
          console.debug('[OHS] Recently dismissed → suppress prompt');
          if (isMounted) { setChecking(false); setOpen(false); }
          return;
        }

        // Check Firestore for recent completion (fail-open on errors)
        try {
          const formsRef = collection(db, 'jobs', jobId, 'ohsForms');
          const q = query(formsRef, orderBy('completedAt', 'desc'), limit(1));
          const snap = await getDocs(q);
          let recentlyCompleted = false;
          if (!snap.empty) {
            const data = snap.docs[0].data();
            const completedAt =
              data?.completedAt?.toDate ? data.completedAt.toDate() :
              (data?.completedAt instanceof Date ? data.completedAt : null);
            if (withinHours(completedAt, COMPLETED_HOURS)) {
              recentlyCompleted = true;
            }
          }
          if (recentlyCompleted) {
            console.debug('[OHS] Firestore shows recent completion → suppress prompt');
            if (isMounted) { setChecking(false); setOpen(false); }
          } else {
            console.debug('[OHS] Showing prompt');
            if (isMounted) { setChecking(false); setOpen(true); }
          }
        } catch (fireErr) {
          console.debug('[OHS] Firestore check failed, failing open → show prompt', fireErr);
          if (isMounted) { setChecking(false); setOpen(true); }
        }
      } catch (e) {
        console.debug('[OHS] Unexpected error, failing open → show prompt', e);
        if (isMounted) { setChecking(false); setOpen(true); }
      }
    }

    checkShouldPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobStatus, location.search]);

  const handleNotNow = () => {
    localStorage.setItem(dismissKey, String(Date.now()));
    setOpen(false);
  };

  const handleYes = () => {
    setOpen(false);
    history.push(`/jobs/${jobId}/ohs`);
  };

  if (checking) return <Box sx={{ display: 'none' }}><CircularProgress size={18} /></Box>;

  return (
    <Dialog open={open} onClose={handleNotNow} maxWidth="xs" fullWidth>
      <DialogTitle>OHS Required</DialogTitle>
      <DialogContent>
        <Typography>
          All jobs require OHS forms to be completed. Would you like to do this now?
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleNotNow} variant="text">Not now</Button>
        <Button onClick={handleYes} variant="contained">Yes</Button>
      </DialogActions>
    </Dialog>
  );
}
