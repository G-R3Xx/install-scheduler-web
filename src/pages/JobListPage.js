// src/pages/JobListPage.js
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Switch,
  FormControlLabel,
} from "@mui/material";
import { useHistory } from "react-router-dom";
import {
  collection,
  getDocs,
  getCountFromServer,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useAuth } from "../contexts/AuthContext";
import PhotoCameraRoundedIcon from "@mui/icons-material/PhotoCameraRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";

// Small badge chip used for icons on the right
function IconBadge({ icon, label, bg }) {
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

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  // Load jobs, then augment each with photosCount + totalHours
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // Base jobs ordered by date (null dates will fall last in FE grouping)
        const q = query(collection(db, "jobs"), orderBy("installDate"));
        const snap = await getDocs(q);
        const base = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

        // For each job, load subcollection aggregates
        const augmented = await Promise.all(
          base.map(async (j) => {
            try {
              // Count completedPhotos quickly
              let photosCount = 0;
              try {
                const photosRef = collection(db, "jobs", j.id, "completedPhotos");
                const cnt = await getCountFromServer(photosRef);
                photosCount = cnt.data().count || 0;
              } catch {
                // fallback: naive count
                const photosSnap = await getDocs(
                  collection(db, "jobs", j.id, "completedPhotos")
                );
                photosCount = photosSnap.size;
              }

              // Sum timeEntries.hours
              let totalHours = 0;
              try {
                const timeSnap = await getDocs(
                  collection(db, "jobs", j.id, "timeEntries")
                );
                timeSnap.forEach((d) => {
                  const h = Number((d.data() || {}).hours || 0);
                  if (Number.isFinite(h)) totalHours += h;
                });
              } catch {
                totalHours = 0;
              }

              return { ...j, _photosCount: photosCount, _totalHours: totalHours };
            } catch {
              return { ...j, _photosCount: 0, _totalHours: 0 };
            }
          })
        );

        if (alive) setJobs(augmented);
      } catch (err) {
        console.error("Failed to load jobs:", err);
        if (alive) setJobs([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Group jobs by day label and (optionally) filter completed
  const grouped = useMemo(() => {
    const groups = {};
    for (const j of jobs) {
      const status = (j.status || "").toLowerCase();
      const isCompleted = status === "completed" || status === "complete";
      if (!showCompleted && isCompleted) continue;

      const d = j.installDate?.toDate
        ? j.installDate.toDate()
        : j.installDate instanceof Date
        ? j.installDate
        : null;

      const key = d
        ? d.toLocaleDateString(undefined, {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "Unscheduled";

      if (!groups[key]) groups[key] = [];
      groups[key].push(j);
    }
    // Keep insertion order; each group preserves installDate order (from query)
    return Object.entries(groups).map(([label, jobs]) => ({ label, jobs }));
  }, [jobs, showCompleted]);

  if (loading) {
    return (
      <Box
        sx={{
          p: 6,
          display: "grid",
          justifyItems: "center",
          gap: 2,
          color: "#fff",
          bgcolor: "rgba(15,23,42,0.75)",
          borderRadius: 2,
          maxWidth: 480,
          mx: "auto",
          mt: 6,
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        }}
      >
        <CircularProgress sx={{ color: "#fff" }} />
        <Typography sx={{ fontWeight: 700, letterSpacing: 0.2 }}>
          Loading jobs…
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          Pulling photos & hours — this can take a moment on slow networks.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Header row */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          mb: 2,
          alignItems: "center",
        }}
      >
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <Button onClick={() => history.push("/jobs/create")} variant="contained">
            Create Job
          </Button>

          <FormControlLabel
            control={
              <Switch
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />
            }
            label="Show Completed"
            sx={{ color: "#fff" }}
          />
        </Box>
      </Box>

      {/* Groups by day */}
      {grouped.map((group, idx) => (
        <Box key={group.label} sx={{ mb: 3 }}>
          {/* Day heading + helper text only once (first visible date row) */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 3,
              mb: 1.5,
            }}
          >
            <Typography variant="h6" sx={{ color: "#fff" }}>
              {group.label}
            </Typography>
            {idx === 0 && (
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)", mr: 0.5 }}
              >
                Allowed hours are a combined total of all staff
              </Typography>
            )}
          </Box>

          {group.jobs.map((j) => {
            const d = j.installDate?.toDate
              ? j.installDate.toDate()
              : j.installDate instanceof Date
              ? j.installDate
              : null;

            const timeStr =
              j.installTime && d
                ? d.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;

            const photos = Number(j._photosCount || 0);
            const hours = Number(j._totalHours || 0);
            const hoursLabel = hours.toFixed(2); // 2 dp as requested

            const status = (j.status || "").toLowerCase();
            const isCompleted = status === "completed" || status === "complete";

            return (
              <Paper
                key={j.id}
                onClick={() => history.push(`/jobs/${j.id}`)}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                  mb: 1.25, // space between cards on the same day
                  ":hover": { bgcolor: "rgba(255,255,255,0.08)" },
                  border: isCompleted
                    ? "1px dashed rgba(255,255,255,0.25)"
                    : "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {/* Left: logo + core info */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  {j.companyLogoUrl && (
                    <img
                      src={j.companyLogoUrl}
                      alt="logo"
                      style={{
                        height: 40,
                        width: 40,
                        objectFit: "contain",
                        borderRadius: 4,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    />
                  )}

                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {j.clientName || "Untitled"}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.85 }}>
                      Assigned{" "}
                      {Array.isArray(j.assignedTo) && j.assignedTo.length
                        ? j.assignedTo
                            .map(
                              (uid) =>
                                userMap?.[uid]?.shortName ||
                                userMap?.[uid]?.displayName ||
                                "User"
                            )
                            .join(", ")
                        : "—"}
                    </Typography>

                    {/* Time chip under the names (only if set) */}
                    {timeStr && (
                      <Chip
                        size="small"
                        label={timeStr}
                        sx={{
                          mt: 0.5,
                          bgcolor: "rgba(255,193,7,0.15)",
                          color: "#ffc107",
                          fontWeight: 800,
                          border: "1px solid rgba(255,193,7,0.4)",
                        }}
                      />
                    )}

                    {/* If this is a survey-request, highlight prominently near time area */}
                    {j.jobType === "survey-request" && (
                      <Chip
                        size="small"
                        label="SURVEY REQUEST"
                        icon={<AssignmentTurnedInRoundedIcon />}
                        sx={{
                          mt: 0.5,
                          bgcolor: "rgba(244,67,54,0.2)",
                          color: "#ef9a9a",
                          fontWeight: 900,
                          border: "1px solid rgba(244,67,54,0.45)",
                          ".MuiChip-icon": { color: "#ef9a9a !important" },
                        }}
                      />
                    )}
                  </Box>
                </Box>

                {/* Right: icons row + allowed hours chip below */}
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <IconBadge
                      icon={<PhotoCameraRoundedIcon fontSize="small" />}
                      label={String(photos)}
                      bg="#2196f3"
                    />
                    <IconBadge
                      icon={<AccessTimeRoundedIcon fontSize="small" />}
                      label={hoursLabel}
                      bg="#7e57c2"
                    />
                  </Box>

                  {Number.isFinite(Number(j.allowedHours)) && (
                    <Chip
                      size="small"
                      label={`Quoted: ${Number(j.allowedHours)}`}
                      sx={{
                        bgcolor: "rgba(0,188,212,0.20)",
                        color: "#80deea",
                        border: "1px solid rgba(0,188,212,0.45)",
                        fontWeight: 900,
                        mt: 0.25,
                      }}
                    />
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
