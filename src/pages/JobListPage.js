// src/pages/JobListPage.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Paper,
  Tab,
  Tabs,
  Typography,
  Switch,
  FormControlLabel,
  Chip,
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

/* ---------- helpers ---------- */
const fmtDate = (date) => {
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

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

  /* ---------- data: jobs ---------- */
  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const col = collection(db, 'jobs');
      const snap = await getDocs(col);
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

      const onlyJobs = all.filter((j) => (j.jobType || 'job') !== 'survey');

      const photos = {};
      const hours = {};

      for (const j of onlyJobs) {
        photos[j.id] = Array.isArray(j.completedPhotos) ? j.completedPhotos.length : 0;

        // fetch subcollection timeEntries for each job
        try {
          const sub = await getDocs(collection(db, 'jobs', j.id, 'timeEntries'));
          const total = sub.docs.reduce((sum, d) => sum + (d.data().hours || 0), 0);
          if (total > 0) hours[j.id] = Math.round(total * 10) / 10;
        } catch {
          // ignore
        }
      }

      setPhotoCountMap(photos);
      setHoursMap(hours);

      // Do not pre-filter/sort here; we'll derive in memos below
      setJobs(onlyJobs);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---------- data: surveys ---------- */
  const loadSurveys = useCallback(async () => {
    const col = collection(db, 'jobs');
    const snap = await getDocs(query(col, where('jobType', '==', 'survey')));
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    list.sort((a, b) => {
      const ad = toJSDate(a.createdAt) || 0;
      const bd = toJSDate(b.createdAt) || 0;
      return bd - ad;
    });
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
        .filter((j) => !isCompleted(j) && j.installDate) // keep existing behavior: active need an installDate to show
        .sort((a, b) => {
          const ad = toJSDate(a.installDate) || 0;
          const bd = toJSDate(b.installDate) || 0;
          return ad - bd; // oldest → newest
        }),
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
      return bKey - aKey; // NEWEST first
    });
    return list;
  }, [jobs]);

  // Group only ACTIVE jobs by install date
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

  const openJob = (id) => history.push(`/jobs/${id}`);

  /* ---------- UI ---------- */
  return (
    <Box sx={{ p: 2 }}>
      {/* Add buttons */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button variant="contained" onClick={() => history.push('/jobs/new')}>
          ADD JOB
        </Button>
        <Button variant="outlined" onClick={() => history.push('/surveys/new')}>
          ADD SURVEY
        </Button>
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

          {/* Active (scheduled) groups */}
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

                return (
                  <Paper
                    key={j.id}
                    onClick={() => openJob(j.id)}
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

                    {/* Icons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
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

          {/* Completed section (only when toggled on) */}
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

                return (
                  <Paper
                    key={j.id}
                    onClick={() => openJob(j.id)}
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

                    {/* Icons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
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
              onClick={() => history.push(`/jobs/${s.id}`)}
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
