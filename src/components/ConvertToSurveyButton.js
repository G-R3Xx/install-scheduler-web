
// src/components/ConvertToSurveyButton.js
import React, { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { useHistory } from 'react-router-dom';
import { db } from '../firebase/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function ConvertToSurveyButton({ jobId, currentJobType }) {
  const history = useHistory();
  const [busy, setBusy] = useState(false);

  if (!jobId || currentJobType === 'survey') return null;

  const handleConvert = async () => {
    if (!window.confirm('Convert this job to a Survey draft?')) return;
    try {
      setBusy(true);
      const ref = doc(db, 'jobs', jobId);
      await updateDoc(ref, {
        jobType: 'survey',
        status: 'survey',
        updatedAt: serverTimestamp(),
      });
      history.push('/surveys/new'); // direct the user to create/attach survey details
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outlined" onClick={handleConvert} disabled={busy}>
      {busy ? <CircularProgress size={20} /> : 'Convert to Survey'}
    </Button>
  );
}
