import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import BuildRoundedIcon from "@mui/icons-material/BuildRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";

import { db } from "../firebase/firebase";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { useAuth } from "../contexts/AuthContext";
import { buildMaterialsSummary, buildOrderTaskSeed } from "../utils/orderTaskGenerator";

function formatTs(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

export default function OrderTasksPanel({ orderId, order }) {
  const { profile, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  useEffect(() => {
    if (!orderId) return undefined;

    const qy = query(collection(db, "orders", orderId, "tasks"), orderBy("orderIndex", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load order tasks:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [orderId]);

  const grouped = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      const key = task.group || "Tasks";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    });
    return Array.from(map.entries());
  }, [tasks]);

  const allDone = useMemo(() => tasks.length > 0 && tasks.every((t) => t.status === "done"), [tasks]);

  const materialSummary = useMemo(() => {
    if (order?.materialsSummary) return order.materialsSummary;
    return buildMaterialsSummary(order || {});
  }, [order]);

  const generateTasks = async () => {
    if (!orderId) return;
    if (!Array.isArray(order?.lineItems) || !order.lineItems.length) {
      setSnack({ open: true, msg: "This order has no line items to generate tasks from.", severity: "warning" });
      return;
    }

    setGenerating(true);
    try {
      const seed = buildOrderTaskSeed(order, orderId);
      if (!seed.length) throw new Error("No tasks could be generated from this order.");

      const existing = await getDocs(collection(db, "orders", orderId, "tasks"));
      if (!existing.empty) {
        setSnack({ open: true, msg: "Tasks already exist for this order.", severity: "info" });
        setGenerating(false);
        return;
      }

      const batch = writeBatch(db);

      seed.forEach((task) => {
        const ref = doc(collection(db, "orders", orderId, "tasks"));
        batch.set(ref, {
          ...task,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      batch.update(doc(db, "orders", orderId), {
        materialsSummary: buildMaterialsSummary(order),
        taskCount: seed.length,
        tasksGeneratedAt: serverTimestamp(),
        workflowState: "production_tasks_ready",
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setSnack({ open: true, msg: `${seed.length} task(s) generated.`, severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to generate tasks", severity: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const toggleTask = async (task) => {
    if (!orderId || !task?.id) return;

    const done = task.status === "done";
    const taskRef = doc(db, "orders", orderId, "tasks", task.id);

    try {
      if (done) {
        await updateDoc(taskRef, {
          status: "todo",
          completedAt: deleteField(),
          completedBy: deleteField(),
          completedByName: deleteField(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(taskRef, {
          status: "done",
          completedAt: serverTimestamp(),
          completedBy: user?.uid || "",
          completedByName: profile?.shortName || profile?.displayName || profile?.email || user?.email || "Unknown",
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to update task", severity: "error" });
    }
  };

  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <BuildRoundedIcon />
          <Typography variant="h6" sx={{ fontWeight: 900 }}>Production Tasks</Typography>
          {allDone ? <Chip size="small" color="success" label="All complete" /> : null}
        </Stack>

        {tasks.length === 0 ? (
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <AssignmentTurnedInRoundedIcon />}
            onClick={generateTasks}
            disabled={generating}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 900 }}
          >
            {generating ? "Generating…" : "Generate Tasks"}
          </Button>
        ) : (
          <Button
            variant="outlined"
            startIcon={<RestartAltRoundedIcon />}
            onClick={() => setSnack({ open: true, msg: "Tasks already exist. Delete them manually first if you want to rebuild.", severity: "info" })}
            sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
          >
            Rebuild
          </Button>
        )}
      </Stack>

      <Divider sx={{ mb: 2 }} />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Inventory2RoundedIcon fontSize="small" />
            <Typography sx={{ fontWeight: 900 }}>Base materials</Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {(materialSummary?.base || []).length ? (
              materialSummary.base.map((m) => (
                <Chip key={`base-${m.name}`} label={`${m.name} • ${m.usageLabel}`} variant="outlined" />
              ))
            ) : (
              <Typography sx={{ opacity: 0.7 }}>No base materials on this order.</Typography>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Inventory2RoundedIcon fontSize="small" />
            <Typography sx={{ fontWeight: 900 }}>Laminate materials</Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {(materialSummary?.laminate || []).length ? (
              materialSummary.laminate.map((m) => (
                <Chip key={`lam-${m.name}`} label={`${m.name} • ${m.usageLabel}`} variant="outlined" />
              ))
            ) : (
              <Typography sx={{ opacity: 0.7 }}>No laminate required.</Typography>
            )}
          </Stack>
        </Paper>
      </Stack>

      {loading ? (
        <Box sx={{ py: 4, display: "flex", justifyContent: "center" }}><CircularProgress /></Box>
      ) : tasks.length === 0 ? (
        <Alert severity="info">No production tasks yet. New orders can generate tasks automatically from the quote, or you can click <strong>Generate Tasks</strong>.</Alert>
      ) : (
        <Stack spacing={2}>
          {grouped.map(([groupName, groupTasks]) => (
            <Paper key={groupName} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>{groupName}</Typography>
              <Stack spacing={1}>
                {groupTasks.map((task) => {
                  const done = task.status === "done";
                  return (
                    <Paper
                      key={task.id}
                      variant="outlined"
                      sx={{
                        p: 1.25,
                        borderRadius: 2,
                        borderColor: done ? "success.main" : "divider",
                        backgroundColor: done ? "rgba(76, 175, 80, 0.06)" : "background.paper",
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="flex-start">
                        <Checkbox checked={done} onChange={() => toggleTask(task)} />
                        <Box sx={{ flex: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                            <Typography sx={{ fontWeight: 900 }}>{task.title}</Typography>
                            <Chip size="small" label={done ? "Done" : "To do"} color={done ? "success" : "default"} />
                            {task.productName ? <Chip size="small" variant="outlined" label={task.productName} /> : null}
                          </Stack>

                          {task.description ? <Typography sx={{ opacity: 0.8, mt: 0.5 }}>{task.description}</Typography> : null}

                          {(task.materialName || task.laminateMaterialName || task.qty) ? (
                            <Typography sx={{ opacity: 0.68, fontSize: 13, mt: 0.5 }}>
                              {task.materialName ? `Base: ${task.materialName}` : ""}
                              {task.materialName && task.laminateMaterialName ? " • " : ""}
                              {task.laminateMaterialName ? `Lam: ${task.laminateMaterialName}` : ""}
                              {(task.materialName || task.laminateMaterialName) && task.qty ? " • " : ""}
                              {task.qty ? `Qty: ${task.qty}` : ""}
                            </Typography>
                          ) : null}

                          {done ? (
                            <Typography sx={{ opacity: 0.65, fontSize: 12, mt: 0.75 }}>
                              Completed by <strong>{task.completedByName || "Unknown"}</strong> • {formatTs(task.completedAt)}
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={2500}
        onClose={() => setSnack((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.severity} sx={{ width: "100%" }}>{snack.msg}</Alert>
      </Snackbar>
    </Paper>
  );
}
