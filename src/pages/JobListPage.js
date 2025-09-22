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
  onSnapshot,
  orderBy,
  query,
  where,
  getCountFromServer,
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

const fmtTimeAMPM = (date) =>
  !date ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

const lc = (v) => String(v || '').trim().toLowerCase();

// treat multiple variants as completed
const isCompleted = (job) => ['completed', 'complete', 'done', 'closed'].includes(lc(job?.status));

// we only show on the "jobs" tab: real jobs + survey-requests (NOT fully saved surveys)
const isListJob = (j) => {
  const t = lc(j?.jobType || 'job');
  return t === 'job' || t === 'survey-request';
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

  const [initialLoading, setInitialLoading] = useState(true);

  /* ---------- stream jobs in real-time (renders ASAP) ---------- */
  useEffect(() => {
    const qAll = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qAll,
      (snap) => {
        const lst = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setJobs(lst);
        setInitialLoading(false);
        // kick off background badge computation
        computeBadges(lst);
      },
      () => setInitialLoading(false) // even on error, unblock UI
    );
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- surveys tab data ---------- */
  useEffect(() => {
    const qSurv = query(collection(db, 'jobs'), where('jobType', '==', 'survey'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qSurv,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setSurveys(list);
      },
      () => {}
    );
    return unsub;
  }, []);

  /* ---------- compute badges asynchronously (non-blocking) ---------- */
  const computeBadges = useCallback(async (list) => {
    if (!Array.isArray(list) || list.length === 0) return;

    // Only compute for items that will be displayed on JOBS tab (fewer calls)
    const visible = list.filter(isListJob);

    // Work in the background; do small batches first so UI gets counts quickly
    const batchSize = 10;
    const doBatch = async (slice) => {
      const photos = {};
      const hours = {};
      await Promise.allSettled(
        slice.map(async (j) => {
          // Photos: try subcollection count; fallback to array length
          try {
            const subCol = collection(db, 'jobs', j.id, 'completedPhotos');
            const cnt = await getCountFromServer(subCol);
            photos[j.id] = Number(cnt.data().count || 0);
          } catch {
            photos[j.id] = Array.isArray(j.completedPhotos) ? j.completedPhotos.length : 0;
          }

          // Hours: best-effort sum of timeEntries
          try {
            const sub = await getDocs(collection(db, 'jobs', j.id, 'timeEntries'));
            const total = sub.docs.reduce((sum, d) => sum + (d.data().hours || 0), 0);
            if (total > 0) hours[j.id] = Math.round(total * 10) / 10;
          } catch {
            // ignore
          }
        })
      );
      setPhotoCountMap((prev) => ({ ...prev, ...photos }));
      setHoursMap((prev) => ({ ...prev, ...hours }));
    };

    for (let i = 0; i < visible.length; i += batchSize) {
      // eslint-disable-next-line no-await-in-loop
      await doBatch(visible.slice(i, i + batchSize));
    }
  }, []);

  /* ---------- derived ---------- */
  const activeJobs = useMemo(() => {
    // only jobs + survey-requests, and not completed, with a scheduled date
    return jobs
      .filter((j) => isListJob(j) && !isCompleted(j) && j.installDate)
      .sort((a, b) => {
        const ad = toJSDate(a.installDate) || 0;
        const bd = toJSDate(b.installDate) || 0;
        return ad - bd; // oldest → newest
      });
  }, [jobs]);

  const completedJobsSorted = useMemo(() => {
    const list = jobs.filter((j) => isListJob(j) && isCompleted(j));
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

  // Open Site Survey capture when it's a survey-request; otherwise open Job Detail
  const openItem = (j) => {
    const type = lc(j?.jobType || 'job');
    if (type === 'survey-request') {
      const params = new URLSearchParams({ jobId: j.id });
      history.push(`/surveys/new?${params.toString()}`);
    } else {
      history.push(`/jobs/${j.id}`);
    }
  };

  /* ---------- UI ---------- */
  return (
    <Box sx={{ p: 2 }}>
      {/* Create button only (no Add Survey button) */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button variant="contained" onClick={() => history.push('/jobs/new')}>
          ADD JOB
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

      {/* High-contrast loading panel */}
      {initialLoading && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 2,
            borderRadius: 2,
            bgcolor: '#0f172a',
            color: '#fff',
            border: '1px dashed rgba(255,255,255,0.25)',
            textAlign: 'center',
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          Loading jobs…
        </Paper>
      )}

      {tab === 'jobs' && (
        <>
          {!initialLoading && activeGroups.length === 0 && !showCompleted && (
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
                const photos = photoCountMap[j.id] ?? (Array.isArray(j.completedPhotos) ? j.completedPhotos.length : 0);
                const hours = hoursMap[j.id] || 0;
                const installDate = toJSDate(j.installDate);
                const timeLabel = installDate && j.installTime ? fmtTimeAMPM(installDate) : '';

                const showSurveyChip = lc(j.jobType) === 'survey-request';
                const allowed = Number(j.allowedHours) || null;

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
                    {/* Logo / initials */}
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

                      {/* Assigned line */}
                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        Assigned: {assignedNames(j)}
                      </Typography>

                      {/* Time + Survey chip row */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                        {timeLabel && (
                          <Chip
                            size="small"
                            icon={<AccessTimeRoundedIcon />}
                            label={timeLabel}
                            sx={{
                              fontWeight: 700,
                              bgcolor: 'rgba(33,150,243,0.12)',
                              color: '#90caf9',
                            }}
                          />
                        )}
                        {showSurveyChip && (
                          <Chip
                            size="small"
                            label="SURVEY REQUEST"
                            sx={{
                              fontWeight: 800,
                              letterSpacing: 0.4,
                              bgcolor: 'rgba(255,193,7,0.2)',
                              color: '#ffca28',
                              border: '1px solid rgba(255,193,7,0.45)',
                            }}
                          />
                        )}
                      </Box>
                    </Box>

                    {/* Right icon stack */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
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
                      {/* Allowed hours always shown here if present */}
                      {Number.isFinite(allowed) && allowed > 0 && (
                        <Chip
                          size="small"
                          label={`Allowed: ${allowed}`}
                          sx={{
                            mt: 0.5,
                            bgcolor: 'rgba(76,175,80,0.15)',
                            color: '#a5d6a7',
                            border: '1px solid rgba(76,175,80,0.35)',
                          }}
                        />
                      )}
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
                const photos = photoCountMap[j.id] ?? (Array.isArray(j.completedPhotos) ? j.completedPhotos.length : 0);
                const hours = hoursMap[j.id] || 0;
                const completedOn =
                  toJSDate(j.completedAt) ||
                  toJSDate(j.installDate) ||
                  toJSDate(j.createdAt);
                const allowed = Number(j.allowedHours) || null;

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

                    {/* Icons + Allowed */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
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
                      {Number.isFinite(allowed) && allowed > 0 && (
                        <Chip
                          size="small"
                          label={`Allowed: ${allowed}`}
                          sx={{
                            mt: 0.5,
                            bgcolor: 'rgba(76,175,80,0.15)',
                            color: '#a5d6a7',
                            border: '1px solid rgba(76,175,80,0.35)',
                          }}
                        />
                      )}
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
