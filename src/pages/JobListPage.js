import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box, Button, Paper, Tab, Tabs, Typography,
  Switch, FormControlLabel, Chip,
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

/* ---------- helpers ---------- */
const fmtDate = (date) =>
  !date
    ? ''
    : date.toLocaleDateString(undefined, {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

const fmtTime = (date) =>
  !date
    ? ''
    : date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true, // AM/PM
      });

const toJSDate = (tsOrDate) =>
  tsOrDate?.toDate?.() instanceof Date
    ? tsOrDate.toDate()
    : tsOrDate instanceof Date
    ? tsOrDate
    : null;

const dayKey = (tsOrDate) => {
  const d = toJSDate(tsOrDate);
  if (!d) return 'no-date';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
};

const isCompleted = (job) => {
  const s = String(job?.status || '').toLowerCase();
  return s === 'complete' || s === 'completed';
};

const isSurveyType = (job) => String(job?.jobType || '').toLowerCase() === 'survey';
const isSurveyRequest = (job) => String(job?.jobType || '').toLowerCase() === 'survey-request';

function IconWithBadge({ icon, count, badgeColor }) {
  const n = Number(count);
  const has = Number.isFinite(n) && n > 0;
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Box
        sx={{
          width: 34,
          height: 28,
          borderRadius: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(255,255,255,0.1)',
          color: '#fff',
        }}
      >
        {icon}
      </Box>
      {has && (
        <Chip
          label={String(n)}
          size="small"
          sx={{
            position: 'absolute',
            top: -10,
            right: -10,
            height: 20,
            bgcolor: badgeColor,
            color: '#fff',
            '& .MuiChip-label': { px: 0.75, fontWeight: 700, fontSize: 12 },
          }}
        />
      )}
    </Box>
  );
}

/* ---------- page ---------- */
export default function JobListPage() {
  const history = useHistory();
  const { userMap } = useAuth();

  const [tab, setTab] = useState('jobs');
  const [showCompleted, setShowCompleted] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [hoursMap, setHoursMap] = useState({});
  const [photoCountMap, setPhotoCountMap] = useState({});
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const col = collection(db, 'jobs');
      const snap = await getDocs(col);
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

      const photos = {};
      const hours = {};
      for (const j of all) {
        photos[j.id] = Array.isArray(j.completedPhotos) ? j.completedPhotos.length : 0;
        try {
          const sub = await getDocs(collection(db, 'jobs', j.id, 'timeEntries'));
          const total = sub.docs.reduce((sum, d) => sum + (d.data().hours || 0), 0);
          if (total > 0) hours[j.id] = Math.round(total * 10) / 10;
        } catch {
          /* ignore */
        }
      }
      setPhotoCountMap(photos);
      setHoursMap(hours);
      setJobs(all);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSurveys = useCallback(async () => {
    const col = collection(db, 'jobs');
    const snap = await getDocs(query(col, where('jobType', '==', 'survey')));
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    list.sort((a, b) => (toJSDate(b.createdAt) || 0) - (toJSDate(a.createdAt) || 0));
    setSurveys(list);
  }, []);

  useEffect(() => {
    loadJobs();
    loadSurveys();
  }, [loadJobs, loadSurveys]);

  /* ---------- derived ---------- */
  const activeJobs = useMemo(
    () =>
      jobs
        .filter((j) => !isCompleted(j) && j.installDate) // includes jobs + survey-requests (+ surveys with dates)
        .sort((a, b) => (toJSDate(a.installDate) || 0) - (toJSDate(b.installDate) || 0)),
    [jobs]
  );

  const completedJobsSorted = useMemo(() => {
    const list = jobs.filter(isCompleted);
    list.sort((a, b) => {
      const aKey =
        toJSDate(a.completedAt) ||
        toJSDate(a.installDate) ||
        toJSDate(a.createdAt) ||
        new Date(0);
      const bKey =
        toJSDate(b.completedAt) ||
        toJSDate(b.installDate) ||
        toJSDate(b.createdAt) ||
        new Date(0);
      return bKey - aKey;
    });
    return list;
  }, [jobs]);

  const activeGroups = useMemo(() => {
    const map = new Map();
    activeJobs.forEach((j) => {
      const k = dayKey(j.installDate);
      const d = toJSDate(j.installDate);
      if (!map.has(k)) map.set(k, { key: k, date: d, items: [] });
      map.get(k).items.push(j);
    });
    return Array.from(map.values()).sort((a, b) => (a.date || 0) - (b.date || 0));
  }, [activeJobs]);

  const assignedNames = (j) => {
    const ids = Array.isArray(j.assignedTo) ? j.assignedTo : j.assignedTo ? [j.assignedTo] : [];
    if (!ids.length) return 'Unassigned';
    return ids
      .map(
        (id) =>
          userMap?.[id]?.shortName ||
          userMap?.[id]?.displayName ||
          userMap?.[id]?.email ||
          'Unknown'
      )
      .join(', ');
  };

  // Open capture for both 'survey-request' and 'survey'; otherwise Job Detail
  const openItem = (j) => {
    const type = String(j?.jobType || 'job').toLowerCase();
    if (type === 'survey' || type === 'survey request') {
      history.push(`/surveys/${j.id}`); // open existing survey
    } else {
      history.push(`/jobs/${j.id}`);
    }
  };

  /* ---------- UI ---------- */
  return (
    <Box sx={{ p: 2 }}>
      {/* Add button(s) */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button variant="contained" onClick={() => history.push('/jobs/new')}>
          ADD JOB
        </Button>
        {/* "ADD SURVEY" removed */}
      </Box>

      {/* Tabs + completed toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="jobs" label="JOBS" />
          <Tab value="surveys" label="SURVEYS" />
        </Tabs>
        {tab === 'jobs' && (
          <FormControlLabel
            control={
              <Switch
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />
            }
            label="Show Completed"
          />
        )}
      </Box>

      {tab === 'jobs' && (
        <>
          {loading && <Typography>Loading…</Typography>}
          {!loading && activeGroups.length === 0 && !showCompleted && (
            <Typography>No jobs to show.</Typography>
          )}

          {/* Active groups */}
          {activeGroups.map((g) => (
            <Box key={g.key} sx={{ mt: 2 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {fmtDate(g.date)}
              </Typography>

              {g.items.map((j) => {
                const client = j.clientName || j.client || 'Untitled';
                const logo = j.companyLogoUrl || '';
                const photos = photoCountMap[j.id] || 0;
                const hours = hoursMap[j.id] || 0;
                const jsDate = toJSDate(j.installDate);
                const showTime = !!j.installTime;

                return (
                  <Paper
                    key={j.id}
                    onClick={() => openItem(j)}
                    sx={{
                      p: 1.5,
                      mb: 1,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      cursor: 'pointer',
                      bgcolor: 'rgba(255,255,255,0.04)',
                      ':hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                    }}
                  >
                    {/* Logo */}
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1.2,
                        bgcolor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {logo ? (
                        <img
                          src={logo}
                          alt="logo"
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <Typography sx={{ fontWeight: 800, color: '#111' }}>
                          {client.slice(0, 2).toUpperCase()}
                        </Typography>
                      )}
                    </Box>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{client}</Typography>
                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        Assigned: {assignedNames(j)}
                      </Typography>
                    </Box>

                    {/* Time + Icons + badges */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {showTime && jsDate && (
                        <Chip
                          icon={<AccessTimeRoundedIcon />}
                          label={fmtTime(jsDate)}
                          size="small"
                          variant="outlined"
                          sx={{
                            color: '#fff',
                            borderColor: 'rgba(255,255,255,0.3)',
                            '& .MuiChip-icon': { color: '#fff' },
                          }}
                        />
                      )}
                      {isSurveyRequest(j) && (
                        <Chip label="SURVEY REQUEST" size="small" color="warning" sx={{ fontWeight: 700 }} />
                      )}
                      {isSurveyType(j) && (
                        <Chip label="SURVEY" size="small" color="info" sx={{ fontWeight: 700 }} />
                      )}
                      <IconWithBadge
                        icon={<PhotoCameraRoundedIcon fontSize="small" />}
                        count={photos}
                        badgeColor="#2196f3"
                      />
                      <IconWithBadge
                        icon={<AccessTimeRoundedIcon fontSize="small" />}
                        count={hours}
                        badgeColor="#7e57c2"
                      />
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          ))}

          {/* Completed section */}
          {showCompleted && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Completed
              </Typography>

              {completedJobsSorted.length === 0 && (
                <Typography color="text.secondary">No completed jobs.</Typography>
              )}

              {completedJobsSorted.map((j) => {
                const client = j.clientName || j.client || 'Untitled';
                const logo = j.companyLogoUrl || '';
                const photos = photoCountMap[j.id] || 0;
                const hours = hoursMap[j.id] || 0;
                const completedOn =
                  toJSDate(j.completedAt) ||
                  toJSDate(j.installDate) ||
                  toJSDate(j.createdAt);
                const showTime = !!j.installTime;

                return (
                  <Paper
                    key={j.id}
                    onClick={() => openItem(j)}
                    sx={{
                      p: 1.5,
                      mb: 1,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      cursor: 'pointer',
                      bgcolor: 'rgba(255,255,255,0.04)',
                      ':hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                    }}
                  >
                    {/* Logo */}
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1.2,
                        bgcolor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {logo ? (
                        <img
                          src={logo}
                          alt="logo"
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <Typography sx={{ fontWeight: 800, color: '#111' }}>
                          {client.slice(0, 2).toUpperCase()}
                        </Typography>
                      )}
                    </Box>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{client}</Typography>
                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        Completed on: {completedOn ? fmtDate(completedOn) : '—'}
                      </Typography>
                    </Box>

                    {/* Time + Icons + badges */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {showTime && toJSDate(j.installDate) && (
                        <Chip
                          icon={<AccessTimeRoundedIcon />}
                          label={fmtTime(toJSDate(j.installDate))}
                          size="small"
                          variant="outlined"
                          sx={{
                            color: '#fff',
                            borderColor: 'rgba(255,255,255,0.3)',
                            '& .MuiChip-icon': { color: '#fff' },
                          }}
                        />
                      )}
                      {isSurveyRequest(j) && (
                        <Chip label="SURVEY REQUEST" size="small" color="warning" sx={{ fontWeight: 700 }} />
                      )}
                      {isSurveyType(j) && (
                        <Chip label="SURVEY" size="small" color="info" sx={{ fontWeight: 700 }} />
                      )}
                      <IconWithBadge
                        icon={<PhotoCameraRoundedIcon fontSize="small" />}
                        count={photos}
                        badgeColor="#2196f3"
                      />
                      <IconWithBadge
                        icon={<AccessTimeRoundedIcon fontSize="small" />}
                        count={hours}
                        badgeColor="#7e57c2"
                      />
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          )}
        </>
      )}

      {tab === 'surveys' && (
        <Box sx={{ mt: 2 }}>
          {surveys.map((s) => (
            <Paper
              key={s.id}
               onClick={() => history.push(`/surveys/${s.id}`)}
              sx={{
                p: 1.5,
                mb: 1,
                borderRadius: 2,
                cursor: 'pointer',
                bgcolor: 'rgba(255,255,255,0.04)',
                ':hover': { bgcolor: 'rgba(255,255,255,0.06)' },
              }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {s.clientName || s.client || 'Untitled Survey'}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
