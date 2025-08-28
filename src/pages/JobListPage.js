// src/pages/JobListPage.js
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Tabs,
  Tab,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import { subscribeToAllJobs } from '../services/jobService';

export default function JobListPage() {
  const history = useHistory();

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0); // 0 = Jobs, 1 = Surveys

  useEffect(() => {
    const unsub = subscribeToAllJobs((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setJobs(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const jobsOnly = jobs.filter((j) => j.jobType !== 'survey');   // treat undefined as install
  const surveysOnly = jobs.filter((j) => j.jobType === 'survey');

  const openJob = (jobId) => history.push(`/jobs/${jobId}`);

  return (
    <Box p={3}>
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="h5" gutterBottom>
          Job List
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => history.push('/jobs/new')}>
            Create Job
          </Button>
          <Button variant="outlined" onClick={() => history.push('/surveys/new')}>
            Create Survey
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ mb: 2 }}
          textColor="primary"
          indicatorColor="primary"
        >
          <Tab label="Jobs" />
          <Tab label="Surveys" />
        </Tabs>

        {loading ? (
          <CircularProgress />
        ) : (
          <>
            {tab === 0 && (
              <List>
                {jobsOnly.length === 0 && (
                  <Typography color="text.secondary" sx={{ p: 2 }}>
                    No jobs found.
                  </Typography>
                )}
                {jobsOnly.map((job) => (
                  <ListItem key={job.id} disablePadding>
                    <ListItemButton onClick={() => openJob(job.id)}>
                      <ListItemText
                        primary={job.clientName || 'Untitled Job'}
                        secondary={job.status || ''}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}

            {tab === 1 && (
              <List>
                {surveysOnly.length === 0 && (
                  <Typography color="text.secondary" sx={{ p: 2 }}>
                    No surveys found.
                  </Typography>
                )}
                {surveysOnly.map((s) => (
                  <ListItem key={s.id} disablePadding>
                    <ListItemButton onClick={() => openJob(s.id)}>
                      <ListItemText
                        primary={`Survey – ${s.clientName || 'Untitled'}`}
                        secondary={s.status || ''}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}
