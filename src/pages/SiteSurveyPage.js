// src/pages/SiteSurveyPage.js
import React, { useState } from 'react';
import { Box, Button, Divider, TextField, Typography } from '@mui/material';
import { v4 as uuid } from 'uuid';
import SurveyAnnotator from '../components/SurveyAnnotator';

export default function SiteSurveyPage() {
  const [client, setClient] = useState({
    name: '', contact: '', phone: '', email: '', address: ''
  });

  const [signs, setSigns] = useState([
    {
      id: uuid(),
      name: 'Sign 1',
      description: '',
      file: null,
      stageJSON: null,
      annotatedBlob: null
    }
  ]);

  const addSign = () =>
    setSigns(s => [
      ...s,
      { id: uuid(), name: `Sign ${s.length + 1}`, description: '', file: null, stageJSON: null, annotatedBlob: null }
    ]);

  const onFile = (idx, file) => {
    const next = [...signs];
    next[idx].file = file;
    setSigns(next);
  };

  const onAnnotSave = (idx, { stageJSON, annotatedBlob }) => {
    const next = [...signs];
    next[idx].stageJSON = stageJSON;
    next[idx].annotatedBlob = annotatedBlob;
    setSigns(next);
  };

  const saveSurveyLocallyForNow = () => {
    console.log('Client:', client);
    console.log('Signs:', signs.map(s => ({
      id: s.id,
      name: s.name,
      hasOriginal: !!s.file,
      hasAnnotation: !!s.annotatedBlob
    })));
    alert('Survey captured (local only). Next step: wire Firebase save + email.');
  };

  return (
    <Box sx={{ p: 2, display: 'grid', gap: 2 }}>
      <Typography variant="h5">New Site Survey</Typography>
      <Divider />

      <TextField label="Client" value={client.name} onChange={e => setClient({ ...client, name: e.target.value })} fullWidth />
      <TextField label="Contact Person" value={client.contact} onChange={e => setClient({ ...client, contact: e.target.value })} fullWidth />
      <TextField label="Contact Phone" value={client.phone} onChange={e => setClient({ ...client, phone: e.target.value })} fullWidth />
      <TextField label="Contact Email" value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} fullWidth />
      <TextField label="Site Address" value={client.address} onChange={e => setClient({ ...client, address: e.target.value })} fullWidth />

      <Divider sx={{ my: 1 }} />

      {signs.map((s, i) => (
        <Box key={s.id} sx={{ p: 2, border: '1px solid #444', borderRadius: 2, display: 'grid', gap: 1 }}>
          <Typography variant="h6">{s.name}</Typography>
          <TextField
            label="Description"
            value={s.description}
            onChange={e => {
              const next = [...signs];
              next[i].description = e.target.value;
              setSigns(next);
            }}
            fullWidth
          />
          <input type="file" accept="image/*" onChange={e => onFile(i, e.target.files?.[0] || null)} />

          {s.file && (
            <SurveyAnnotator
              file={s.file}
              tools={['text', 'line', 'arrow', 'rect', 'circle']}
              onSave={(payload) => onAnnotSave(i, payload)}
            />
          )}
        </Box>
      ))}

      <Button onClick={addSign}>Add another sign</Button>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={saveSurveyLocallyForNow}>Save Survey</Button>
      </Box>
    </Box>
  );
}
