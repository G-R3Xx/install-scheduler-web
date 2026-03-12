import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";

import { db } from "../firebase/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { makeDocNumber } from "../utils/numbering";

const norm = (s) => (s || "").toString().trim().toLowerCase();

function statusChip(status) {
  const s = (status || "open").toString().toLowerCase();
  const map = {
    open: { label: "Open", color: "info" },
    scheduled: { label: "Scheduled", color: "primary" },
    in_progress: { label: "In Progress", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "default" },
  };
  const v = map[s] || map.open;
  return <Chip size="small" label={v.label} color={v.color} />;
}

export default function OrdersPage() {
  const history = useHistory();
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });
  const [confirmDelete, setConfirmDelete] = useState(null); // {id, orderNumber, hasInstallJob}

  useEffect(() => {
    const qy = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setErr("");
        setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (e) => {
        console.error(e);
        setErr(e?.message || "Failed to load orders");
      }
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = norm(search);
    if (!s) return orders;
    return orders.filter((o) => {
      const a = `${o.orderNumber || ""} ${o.clientSnapshot?.companyName || ""} ${o.clientSnapshot?.contactName || ""} ${o.notes || ""}`;
      return norm(a).includes(s);
    });
  }, [orders, search]);

  const createBlankOrder = async () => {
    setBusy(true);
    try {
      const orderNumber = makeDocNumber("WO"); // Work Order
      const payload = {
        orderNumber,
        status: "open",
        sourceQuoteId: "",
        quoteNumber: "",
        clientId: "",
        clientSnapshot: null,
        lineItems: [],
        totals: { costTotal: 0, sellTotal: 0, itemCount: 0 },
        notes: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "orders"), payload);
      history.push(`/orders/${ref.id}`);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to create order");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orders", confirmDelete.id));
      setSnack({ open: true, msg: "Order deleted.", severity: "success" });
      setConfirmDelete(null);
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Delete failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Orders
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Work orders are the bridge between <strong>Quotes</strong> and <strong>Install Jobs</strong>.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={createBlankOrder}
          disabled={busy}
          sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
        >
          New Order
        </Button>
      </Stack>

      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
          <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Typography sx={{ opacity: 0.8 }}>{filtered.length} order(s)</Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.25}>
          {filtered.map((o) => (
            <Paper
              key={o.id}
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2, display: "flex", gap: 2, alignItems: "center" }}
            >
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>{o.orderNumber || "WO"}</Typography>
                  {statusChip(o.status)}
                  {o.sourceQuoteId ? (
                    <Chip size="small" label={`From Quote ${o.quoteNumber || ""}`} variant="outlined" />
                  ) : null}
                  {o.installJobId ? <Chip size="small" label="Install job created" variant="outlined" /> : null}
                </Stack>

                <Typography sx={{ opacity: 0.8 }}>
                  {o.clientSnapshot?.companyName || "No client yet"}
                  {o.clientSnapshot?.contactName ? ` • ${o.clientSnapshot.contactName}` : ""}
                </Typography>

                <Typography sx={{ opacity: 0.7, fontSize: 12 }}>
                  Items: {o.totals?.itemCount || 0} • Sell: ${(o.totals?.sellTotal || 0).toFixed(2)}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                endIcon={<OpenInNewRoundedIcon />}
                onClick={() => history.push(`/orders/${o.id}`)}
                sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
              >
                Open
              </Button>

              <IconButton
                title="Delete order"
                onClick={() =>
                  setConfirmDelete({
                    id: o.id,
                    orderNumber: o.orderNumber || "this order",
                    hasInstallJob: !!o.installJobId,
                  })
                }
              >
                <DeleteRoundedIcon />
              </IconButton>
            </Paper>
          ))}

          {filtered.length === 0 ? (
            <Typography sx={{ opacity: 0.7, textAlign: "center", py: 4 }}>
              No orders yet. Click <strong>New Order</strong>.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onClose={() => (busy ? null : setConfirmDelete(null))}>
        <DialogTitle sx={{ fontWeight: 900 }}>Delete order?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Delete <strong>{confirmDelete?.orderNumber}</strong>? This cannot be undone.
          </Typography>

          {confirmDelete?.hasInstallJob ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This order already has an install job linked. Deleting the order will <strong>not</strong> delete the install job.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmDelete(null)} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={doDelete} disabled={busy} sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={2500} onClose={() => setSnack((p) => ({ ...p, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snack.severity} sx={{ width: "100%" }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
