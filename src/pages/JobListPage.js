// src/pages/JobListPage.js
import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Paper,
  CircularProgress,
  Divider,
  Tooltip,
  Badge,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useHistory } from 'react-router-dom';
import { collection, query, onSnapshot, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/firebase';

export default function JobListPage() {
  const history = useHistory();
  const { currentUser } = useAuth();

  const [jobs, setJobs] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);

  // toggles
  const [filterMode, setFilterMode] = useState('active');   // "active" or "completed"
  const [sortNewestFirst, setSortNewestFirst] = useState(false);

  const [hoursMap, setHoursMap] = useState({});
  const [hoursDetail, setHoursDetail] = useState({});

  // Fetch users
  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, 'users'));
      const map = {};
      snap.forEach(doc => {
        const d = doc.data() || {};
        map[doc.id] = d.shortName || d.displayName || d.email || doc.id;
      });
      setUsersMap(map);
    };
    fetchUsers();
  }, []);

  // Live jobs list
  useEffect(() => {
    const q = query(collection(db, 'jobs'));
    const unsub = onSnapshot(q, snap => {
      const allJobs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const filtered = allJobs.filter(job => {
        const status = (job.status || '').toLowerCase();
        const isCompleted = status === 'complete' || status === 'completed';
        return filterMode === 'completed' ? isCompleted : !isCompleted;
      });
      setJobs(filtered);
      setLoading(false);
    });
    return () => unsub();
  }, [filterMode]);

  // Fetch hours totals
  useEffect(() => {
    let cancelled = false;
    async function loadTotals() {
      const results = await Promise.all(
        jobs.map(async (job) => {
          try {
            const snap = await getDocs(collection(db, 'jobs', job.id, 'timeEntries'));
            let total = 0;
            const perUser = {};
            snap.forEach(d => {
              const e = d.data() || {};
              const h = Number(e.hours || 0);
              const uid = e.userId || 'unknown';
              if (!isNaN(h) && h > 0) {
                perUser[uid] = (perUser[uid] || 0) + h;
                total += h;
              }
            });
            return [job.id, total, perUser];
          } catch {
            return [job.id, 0, {}];
          }
        })
      );

      if (!cancelled) {
        const totals = {};
        const details = {};
        for (const [id, total, perUser] of results) {
          totals[id] = total;
          details[id] = perUser;
        }
        setHoursMap(totals);
        setHoursDetail(details);
      }
    }
    if (jobs.length) loadTotals();
    else {
      setHoursMap({});
      setHoursDetail({});
    }
    return () => { cancelled = true; };
  }, [jobs]);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  };

  const formatDate = timestamp => {
    try {
      const date =
        timestamp?.toDate?.() instanceof Date
          ? timestamp.toDate()
          : (timestamp instanceof Date ? timestamp : null);
      if (!date) return 'No date';
      return date.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const getAssignedUserShortNames = assigned => {
    if (!assigned) return 'Unassigned';
    const ids = Array.isArray(assigned) ? assigned : [assigned];
    return ids.map(id => usersMap[id] || 'Unknown').join(', ');
  };

  const groupJobsByDate = jobsArr => {
    const grouped = {};
    for (const job of jobsArr) {
      const label = formatDate(job.installDate);
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(job);
    }
    return grouped;
  };

  const sorted = useMemo(() => {
    const arr = [...jobs];
    arr.sort((a, b) => {
      const aDate = a.installDate?.toDate?.() || new Date(0);
      const bDate = b.installDate?.toDate?.() || new Date(0);
      return sortNewestFirst ? (bDate - aDate) : (aDate - bDate);
    });
    return arr;
  }, [jobs, sortNewestFirst]);

  const groupedJobs = groupJobsByDate(sorted);

  // Pretty tooltip for per-user hours
  const renderHoursTooltip = (jobId, total) => {
    const per = hoursDetail[jobId] || {};
    const entries = Object.entries(per)
      .map(([uid, hrs]) => [usersMap[uid] || uid, hrs])
      .sort((a, b) => b[1] - a[1]);

    return (
      <Box sx={{ p: 0.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Total: {total} hr{total === 1 ? '' : 's'}
        </Typography>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No hours logged yet</Typography>
        ) : (
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            {entries.map(([name, hrs]) => (
              <li key={name}>
                <Typography variant="body2">
                  {name}: <strong>{hrs}</strong> hr{hrs === 1 ? '' : 's'}
                </Typography>
              </li>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Job List
      </Typography>

      <Box display="flex" gap={1} flexWrap="wrap" mb={2} alignItems="center">
        <Button variant="contained" onClick={() => history.push('/jobs/new')}>
          Add Job
        </Button>

        <ToggleButtonGroup
          value={filterMode}
          exclusive
          onChange={(_, val) => val && setFilterMode(val)}
          size="small"
          sx={{
            ml: 1,
            '& .MuiToggleButton-root': {
              borderRadius: '20px',
              px: 2,
              textTransform: 'none',
              fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'white',
            },
            '& .Mui-selected': {
              backgroundColor: theme => theme.palette.secondary.main,
              color: 'white',
              '&:hover': {
                backgroundColor: theme => theme.palette.secondary.dark,
              },
            }
          }}
        >
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="completed">Completed</ToggleButton>
        </ToggleButtonGroup>

        <Button onClick={() => setSortNewestFirst(prev => !prev)}>
          {sortNewestFirst ? 'Oldest First' : 'Newest First'}
        </Button>

        <Button onClick={handleRefresh}>Refresh</Button>
      </Box>

      {loading ? (
        <Box textAlign="center" mt={4}>
          <CircularProgress />
        </Box>
      ) : (
        Object.entries(groupedJobs).map(([dateLabel, jobsOnDate]) => (
          <Box key={dateLabel} mb={3}>
            <Typography variant="h6" gutterBottom>
              {dateLabel}
            </Typography>
            <List>
              {jobsOnDate.map(job => {
                const displayName = job.clientName || job.company || 'Untitled Job';
                const initials = displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map(s => (s[0] || '').toUpperCase())
                  .join('') || 'J';

                const photoCount = Array.isArray(job.completedPhotos) ? job.completedPhotos.length : 0;
                const hasPhotos = photoCount > 0;
                const totalHours = Number(hoursMap[job.id] || 0);

                return (
                  <Paper key={job.id} sx={{ my: 1 }}>
                    <ListItem
                      button
                      onClick={() => history.push(`/jobs/${job.id}`)}
                      secondaryAction={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Tooltip title={hasPhotos ? `${photoCount} completed photo${photoCount>1?'s':''}` : 'No completed photos yet'}>
                            <PhotoLibraryIcon
                              sx={{ color: hasPhotos ? 'rgb(52, 152, 219)' : 'grey.500', cursor: 'default' }}
                            />
                          </Tooltip>

                          <Tooltip title={renderHoursTooltip(job.id, totalHours)}>
                            <Badge
                              badgeContent={totalHours}
                              color="secondary"
                              overlap="circular"
                              sx={{
                                '& .MuiBadge-badge': {
                                  minWidth: 22,
                                  height: 22,
                                  borderRadius: '50%',
                                  fontSize: 12,
                                  fontWeight: 600
                                }
                              }}
                            >
                              <AccessTimeIcon sx={{ color: 'text.secondary' }} />
                            </Badge>
                          </Tooltip>
                        </Box>
                      }
                    >
                      <ListItemAvatar>
                        <Tooltip title={job.company || job.clientName || 'Company'}>
                          <Avatar
                            src={job.companyLogoUrl || undefined}
                            alt="Company Logo"
                            variant="rounded"
                            sx={{
                              width: 36,
                              height: 36,
                              bgcolor: job.companyLogoUrl ? 'transparent' : 'primary.main',
                              border: '1px solid rgba(255,255,255,0.3)',
                              '& img': { backgroundColor: '#fff' }
                            }}
                          >
                            {initials}
                          </Avatar>
                        </Tooltip>
                      </ListItemAvatar>

                      <ListItemText
                        primary={displayName}
                        secondary={`Assigned: ${getAssignedUserShortNames(job.assignedTo)}`}
                      />
                    </ListItem>
                  </Paper>
                );
              })}
            </List>
            <Divider sx={{ mt: 2 }} />
          </Box>
        ))
      )}
    </Box>
  );
}
