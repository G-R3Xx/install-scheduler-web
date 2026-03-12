import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

function responseChip(response) {
  const s = (response || "").toString().toLowerCase();
  const map = {
    accepted: { label: "Accepted", color: "success" },
    changes_requested: { label: "Changes Requested", color: "warning" },
    rejected: { label: "Rejected", color: "error" },
  };
  const v = map[s] || { label: response || "Notification", color: "default" };
  return <Chip size="small" label={v.label} color={v.color} />;
}

function formatDate(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

export default function NotificationsPage() {
  const history = useHistory();
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  useEffect(() => {
    const qy = query(collection(db, "notifications"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setErr("");
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (e) => {
        console.error(e);
        setErr(e?.message || "Failed to load notifications");
      }
    );
    return () => unsub();
  }, []);

  const unreadCount = useMemo(
    () => items.filter((x) => x.isRead === false).length,
    [items]
  );

  const markRead = async (item) => {
    if (!item || item.isRead !== false) return;
    try {
      await updateDoc(doc(db, "notifications", item.id), {
        isRead: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const markAllRead = async () => {
    const unread = items.filter((x) => x.isRead === false);
    if (!unread.length) return;

    setBusy(true);
    try {
      await Promise.all(
        unread.map((item) =>
          updateDoc(doc(db, "notifications", item.id), {
            isRead: true,
            readAt: serverTimestamp(),
          })
        )
      );
      setSnack({ open: true, msg: "All notifications marked read.", severity: "success" });
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Failed to update notifications", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openItem = async (item) => {
    await markRead(item);

    if (item.quoteId) {
      history.push(`/quotes/${item.quoteId}`);
      return;
    }
    if (item.orderId) {
      history.push(`/orders/${item.orderId}`);
      return;
    }

    setSnack({ open: true, msg: "This notification has no linked page yet.", severity: "info" });
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Notifications
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Quote responses and other office events.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<DoneAllRoundedIcon />}
          onClick={markAllRead}
          disabled={busy || unreadCount === 0}
          sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
        >
          Mark all read
        </Button>
      </Stack>

      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <NotificationsRoundedIcon />
          <Typography sx={{ fontWeight: 800 }}>
            {unreadCount} unread
          </Typography>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.25}>
          {items.map((item) => (
            <Paper
              key={item.id}
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 2,
                borderLeft: item.isRead === false ? "4px solid #1976d2" : undefined,
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 900 }}>
                      {item.title || "Notification"}
                    </Typography>
                    {item.response ? responseChip(item.response) : null}
                    {item.isRead === false ? <Chip size="small" label="Unread" color="info" /> : null}
                  </Stack>

                  <Typography sx={{ opacity: 0.82 }}>
                    {item.body || "—"}
                  </Typography>

                  <Typography sx={{ opacity: 0.65, fontSize: 12, mt: 0.5 }}>
                    {item.clientName ? `${item.clientName} • ` : ""}
                    {item.quoteNumber ? `Quote ${item.quoteNumber} • ` : ""}
                    {formatDate(item.createdAt)}
                  </Typography>
                </Box>

                <Button
                  variant="outlined"
                  startIcon={<LaunchRoundedIcon />}
                  onClick={() => openItem(item)}
                  sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                >
                  Open
                </Button>
              </Stack>
            </Paper>
          ))}

          {items.length === 0 ? (
            <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
              No notifications yet.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Snackbar
        open={snack.open}
        autoHideDuration={2500}
        onClose={() => setSnack((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.severity} sx={{ width: "100%" }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
