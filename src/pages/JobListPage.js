// src/pages/JobListPage.js
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Typography,
  Switch,
  Stack,
  Tooltip,
} from "@mui/material";
import PhotoCameraRoundedIcon from "@mui/icons-material/PhotoCameraRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { useHistory } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useAuth } from "../contexts/AuthContext";
import useActiveTimers from "../hooks/useActiveTimers";

const APP_VERSION = "InstallScheduler v25.12.03.05";

function IconBadge({ icon, label, bg = "#1976d2" }) {
  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      sx={{
        bgcolor: bg,
        color: "#fff",
        fontWeight: 700,
        ".MuiChip-icon": { color: "#fff !important" },
      }}
    />
  );
}

export default function JobListPage() {
  const history = useHistory();
  const { userMap } = useAuth();

  const [showCompleted, setShowCompleted] = useState(false); // default OFF
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "jobs"), orderBy("installDate"))
        );
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() || {}) }));
        setJobs(arr);
      } catch (e) {
        console.error("Failed to load jobs", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // More robust date coercion: Timestamp | Date | string | number
  const toJSDate = (v) => {
    if (!v) return null;

    // Firestore Timestamp (v9)
    if (typeof v?.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }

    if (v instanceof Date) {
      return !Number.isNaN(v.getTime()) ? v : null;
    }

    if (typeof v === "string") {
      // handle "YYYY-MM-DD"
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const d = new Date(`${v}T00:00:00`);
        return !Number.isNaN(d.getTime()) ? d : null;
      }
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) ? d : null;
    }

    if (typeof v === "number") {
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) ? d : null;
    }

    return null;
  };

  const isCompleted = (j) => {
    const status = String(j.status || "").toLowerCase();
    return status === "completed" || status === "complete";
  };

  // Single "Jobs" view: normal jobs + survey *requests*, hide proper surveys
  const filtered = useMemo(() => {
    let list = jobs.filter((j) => {
      const completed = isCompleted(j);
      if (!showCompleted && completed) return false;

      const status = String(j.status || "").toLowerCase();
      const jobType = String(j.jobType || "").toLowerCase();

      const isSurveyJob =
        Boolean(j.isSurvey) ||
        jobType === "survey" ||
        status === "survey";

      const isSurveyRequest =
        Boolean(j.isSurveyRequest) ||
        Boolean(j.surveyRequest) ||
        status === "survey-request";

      // behave like old Jobs tab:
      // - normal jobs
      // - plus survey-requests
      if (!isSurveyJob) return true;
      if (isSurveyRequest) return true;

      // pure surveys -> hide from this screen
      return false;
    });

    const upcoming = [];
    const completedArr = [];
    for (const j of list) (isCompleted(j) ? completedArr : upcoming).push(j);

    upcoming.sort((a, b) => {
      const da = toJSDate(a.installDate)?.getTime() || 0;
      const db = toJSDate(b.installDate)?.getTime() || 0;
      return da - db;
    });

    completedArr.sort((a, b) => {
      const da =
        toJSDate(a.completedAt)?.getTime() ||
        toJSDate(a.installDate)?.getTime() ||
        0;
      const db =
        toJSDate(b.completedAt)?.getTime() ||
        toJSDate(b.installDate)?.getTime() ||
        0;
      return db - da; // newest first
    });

    return [...upcoming, ...completedArr];
  }, [jobs, showCompleted]);

  // Live per-user timers
  const jobIds = useMemo(() => filtered.map((j) => j.id), [filtered]);
  const { byJob: timersByJob } = useActiveTimers(jobIds);

  const groups = useMemo(() => {
    const map = new Map();
    for (const j of filtered) {
      const d = toJSDate(j.installDate);
      const label = d
        ? d.toLocaleDateString("en-AU", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "Unscheduled";
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(j);
    }
    return Array.from(map.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [filtered]);

  if (loading) {
    return (
      <Box
        sx={{
          p: 4,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <CircularProgress sx={{ color: "#fff" }} />
        <Typography>Loading jobs…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2, md: 3 } }}>
      {/* Top controls */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          flexWrap: "wrap",
          mb: 2,
        }}
      >
        <Button variant="contained" onClick={() => history.push("/jobs/new")}>
          Add Job
        </Button>

        <Typography
          variant="h6"
          sx={{ fontWeight: 700, color: "#fff", ml: 1 }}
        >
        
        </Typography>

        <Box
          sx={{
            ml: "auto",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Switch
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            color="default"
          />
          <Typography>Show Completed</Typography>
        </Box>
      </Box>

      {/* Groups */}
      {groups.map((g) => (
        <Box key={g.label} sx={{ mb: 3 }}>
          <Typography
            variant="h5"
            sx={{ color: "#fff", mb: 1.5, fontWeight: 700 }}
          >
            {g.label}
          </Typography>
          <Stack spacing={1.25}>
            {g.items.map((j) => {
              const d = toJSDate(j.installDate);
              const timeStr =
                j.installTime && d
                  ? d.toLocaleTimeString("en-AU", {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null;

              const assigned =
                Array.isArray(j.assignedTo) && j.assignedTo.length
                  ? j.assignedTo
                      .map(
                        (uid) =>
                          userMap?.[uid]?.shortName ||
                          userMap?.[uid]?.displayName ||
                          userMap?.[uid]?.email ||
                          "User"
                      )
                      .join(", ")
                  : "—";

              const photos = Number(
                j.completedPhotoCount ??
                  (Array.isArray(j.completedPhotos)
                    ? j.completedPhotos.length
                    : 0) ??
                  0
              );
              const hours = Number(j.hoursTotal || 0);

              const runningList = timersByJob[j.id] || []; // [{ userId, userShortName?, start, formatted }]
              const hasRunning = runningList.length > 0;

              return (
                <Paper
                  key={j.id}
                  onClick={() => history.push(`/jobs/${j.id}`)}
                  sx={{
                    width: "100%",
                    p: 2,
                    borderRadius: 2,
                    bgcolor: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: "pointer",
                    ":hover": { bgcolor: "rgba(255,255,255,0.09)" },
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      minWidth: 0,
                    }}
                  >
                    {j.companyLogoUrl && (
                      <img
                        src={j.companyLogoUrl}
                        alt="logo"
                        style={{
                          height: 48,
                          width: 48,
                          objectFit: "contain",
                          borderRadius: 8,
                          backgroundColor: "rgba(255, 255, 255, 1)",
                        }}
                      />
                    )}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="h6"
                        sx={{ fontSize: 18, fontWeight: 700 }}
                      >
                        {j.clientName || "Untitled"}
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.85 }}>
                        Assigned: {assigned}
                      </Typography>

                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 0.75, flexWrap: "wrap" }}
                      >
                        {timeStr && (
                          <Chip
                            size="small"
                            label={timeStr}
                            sx={{
                              bgcolor: "rgba(255,193,7,0.15)",
                              color: "#ffc107",
                              fontWeight: 800,
                            }}
                          />
                        )}

                        {/* One live chip per user running a timer */}
                        {hasRunning &&
                          runningList.map((e) => {
                            const name =
                              e.userShortName ||
                              userMap?.[e.userId]?.shortName ||
                              userMap?.[e.userId]?.displayName ||
                              userMap?.[e.userId]?.email ||
                              e.userId;
                            return (
                              <Tooltip
                                key={`${j.id}-${e.userId}`}
                                title={`Started ${e.start.toLocaleTimeString(
                                  "en-AU",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}`}
                              >
                                <Chip
                                  size="small"
                                  icon={<TimerOutlinedIcon fontSize="small" />}
                                  label={`${name} — ${e.formatted}`}
                                  sx={{
                                    bgcolor: "rgba(33,150,243,0.2)",
                                    color: "#90caf9",
                                    border:
                                      "1px solid rgba(33,150,243,0.4)",
                                    fontWeight: 800,
                                    cursor: "help",
                                  }}
                                  onClick={(ev) => ev.stopPropagation()}
                                />
                              </Tooltip>
                            );
                          })}
                      </Stack>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 1,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      <IconBadge
                        icon={<PhotoCameraRoundedIcon fontSize="small" />}
                        label={photos}
                        bg="#1976d2"
                      />
                      <IconBadge
                        icon={<AccessTimeRoundedIcon fontSize="small" />}
                        label={hours.toFixed(2)}
                        bg="#7e57c2"
                      />
                    </Box>
                    {Number.isFinite(Number(j.allowedHours)) && (
                      <Chip
                        size="small"
                        label={`Quoted ${Number(j.allowedHours)}h`}
                        sx={{
                          bgcolor: "rgba(0, 188, 212, 0.20)",
                          color: "#80deea",
                          border:
                            "1px solid rgba(0,188,212,0.45)",
                          fontWeight: 800,
                        }}
                      />
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Stack>
        </Box>
      ))}

      {/* Version */}
      <Box
        sx={{
          mt: 2,
          textAlign: "right",
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: "rgba(255,255,255,0.5)" }}
        >
          {APP_VERSION}
        </Typography>
      </Box>
    </Box>
  );
}
