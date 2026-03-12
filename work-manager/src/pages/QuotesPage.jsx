import React, { useEffect, useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";

import { useHistory } from "react-router-dom";
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

const normalize = (s) => (s || "").toString().trim();

function fmtMoney(x) {
  const n = Number(x || 0);
  return `$${n.toFixed(2)}`;
}

function fmtDate(ts) {
  try {
    const d = ts?.toDate?.() ? ts.toDate() : null;
    if (!d) return "";
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

function makeQuoteNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `Q-${y}${m}${day}-${rand}`;
}

export default function QuotesPage() {
  const history = useHistory();

  const [quotes, setQuotes] = useState([]);
  const [loadingErr, setLoadingErr] = useState("");
  const [search, setSearch] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(null); // {id, quoteNumber}
  const [busy, setBusy] = useState(false);

  const [snack, setSnack] = useState({
    open: false,
    msg: "",
    severity: "success",
  });

  useEffect(() => {
    const q = query(collection(db, "quotes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadingErr("");
        setQuotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error(err);
        setLoadingErr(err?.message || "Failed to load quotes");
      }
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = normalize(search).toLowerCase();
    if (!s) return quotes;
    return quotes.filter((q) => {
      const hay = [
        q.quoteNumber,
        q.status,
        q.clientSnapshot?.companyName,
        q.clientSnapshot?.contactName,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [quotes, search]);

  const createQuote = async () => {
    setBusy(true);
    try {
      const quoteNumber = makeQuoteNumber();

      const ref = await addDoc(collection(db, "quotes"), {
        quoteNumber,
        status: "draft",
        clientId: "",
        clientSnapshot: null,
        notes: "",
        lineItems: [],
        totals: { costTotal: 0, sellTotal: 0, itemCount: 0 },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      history.push(`/quotes/${ref.id}`);
    } catch (e) {
      console.error(e);
      setSnack({
        open: true,
        msg: e?.message || "Create quote failed",
        severity: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "quotes", confirmDelete.id));
      setSnack({ open: true, msg: "Quote deleted.", severity: "success" });
      setConfirmDelete(null);
    } catch (e) {
      console.error(e);
      setSnack({
        open: true,
        msg: e?.message || "Delete failed",
        severity: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const statusChip = (status) => {
    const s = (status || "draft").toString().toLowerCase();
    const map = {
      draft: { label: "Draft", color: "default" },
      sent: { label: "Sent", color: "info" },
      accepted: { label: "Accepted", color: "success" },
      rejected: { label: "Rejected", color: "error" },
    };
    const v = map[s] || map.draft;
    return <Chip size="small" label={v.label} color={v.color} />;
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Quotes
          </Typography>
          <Typography sx={{ opacity: 0.8 }}>
            Build quotes from Products. Prices lock as snapshots on the quote.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={createQuote}
          disabled={busy}
          sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
        >
          New Quote
        </Button>
      </Stack>

      {loadingErr && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadingErr}
        </Alert>
      )}

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
          />
          <Box
            sx={{
              minWidth: 180,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <Typography sx={{ opacity: 0.8 }}>
              {filtered.length} quote(s)
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 1 }} />

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Quote</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Client</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Total</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filtered.map((q) => (
              <TableRow key={q.id} hover>
                <TableCell sx={{ fontWeight: 900 }}>
                  {q.quoteNumber || q.id}
                </TableCell>
                <TableCell>{q.clientSnapshot?.companyName || ""}</TableCell>
                <TableCell>{statusChip(q.status)}</TableCell>
                <TableCell sx={{ fontWeight: 900 }}>
                  {fmtMoney(q.totals?.sellTotal || 0)}
                </TableCell>
                <TableCell>{fmtDate(q.createdAt)}</TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    title="Open"
                    onClick={() => history.push(`/quotes/${q.id}`)}
                  >
                    <OpenInNewRoundedIcon fontSize="small" />
                  </IconButton>

                  <IconButton
                    size="small"
                    title="Delete"
                    onClick={() =>
                      setConfirmDelete({
                        id: q.id,
                        quoteNumber: q.quoteNumber || q.id,
                      })
                    }
                  >
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}

            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 4 }}>
                  <Typography sx={{ opacity: 0.7, textAlign: "center" }}>
                    No quotes yet. Click <strong>New Quote</strong>.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog
        open={!!confirmDelete}
        onClose={() => (busy ? null : setConfirmDelete(null))}
      >
        <DialogTitle sx={{ fontWeight: 900 }}>Delete quote?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Delete <strong>{confirmDelete?.quoteNumber}</strong>? This cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setConfirmDelete(null)}
            disabled={busy}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={doDelete}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

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
