// src/hooks/useActiveTimers.js
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase/firebase";

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

/**
 * Per-job listener that pulls *recent* timeEntries and treats
 * entries with missing `end` OR `end === null` as "running".
 * Collapses to one chip per user (earliest start), live-updating.
 */
export default function useActiveTimers(jobIds) {
  const [rawByJob, setRawByJob] = useState({});
  const [now, setNow] = useState(Date.now());
  const unsubsRef = useRef({});

  useEffect(() => {
    // cleanup previous
    Object.values(unsubsRef.current).forEach((u) => u && u());
    unsubsRef.current = {};

    if (!jobIds || jobIds.length === 0) {
      setRawByJob({});
      return;
    }

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const local = {};

    jobIds.forEach((jobId) => {
      // Recent-window query to keep reads reasonable; adjust as needed
      const qRef = query(
        collection(db, "jobs", jobId, "timeEntries"),
        where("start", ">=", fourteenDaysAgo),
        orderBy("start", "desc"),
        limit(50)
      );

      local[jobId] = onSnapshot(qRef, (snap) => {
        const arr = [];
        snap.forEach((doc) => {
          const d = doc.data() || {};
          const start = d.start?.toDate?.();
          // Treat missing end OR explicit null as running
          const isRunning = !("end" in d) || d.end === null;
          if (start && isRunning) {
            arr.push({
              id: doc.id,
              userId: d.userId || "unknown",
              userShortName: d.userShortName,
              start,
            });
          }
        });
        setRawByJob((prev) => ({ ...prev, [jobId]: arr }));
      });
    });

    unsubsRef.current = local;
    return () => Object.values(local).forEach((u) => u && u());
  }, [JSON.stringify(jobIds)]);

  // live tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // collapse to one per user (earliest start), compute elapsed
  const byJob = useMemo(() => {
    const out = {};
    for (const [jobId, entries = []] of Object.entries(rawByJob)) {
      const perUser = new Map();
      for (const e of entries) {
        const k = e.userId || "unknown";
        const existing = perUser.get(k);
        if (!existing || e.start < existing.start) perUser.set(k, e);
      }
      const list = Array.from(perUser.values())
        .map((e) => {
          const elapsedMs = now - e.start.getTime();
          return { ...e, elapsedMs, formatted: formatDuration(elapsedMs) };
        })
        .sort((a, b) => b.elapsedMs - a.elapsedMs);
      out[jobId] = list;
    }
    return out;
  }, [rawByJob, now]);

  return { byJob };
}
