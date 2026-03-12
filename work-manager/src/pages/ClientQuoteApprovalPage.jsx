import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { makeDocNumber } from "../utils/numbering";

const num = (x, fallback = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
};

function money(x) {
  const n = Number(x || 0);
  return `$${n.toFixed(2)}`;
}

export default function ClientQuoteApprovalPage() {
  const { id } = useParams();
  const location = useLocation();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });
  const [error, setError] = useState("");

  const token = useMemo(() => new URLSearchParams(location.search).get("token") || "", [location.search]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "quotes", id));
        if (!snap.exists()) {
          setError("Quote not found.");
          setLoading(false);
          return;
        }
        const q = { id: snap.id, ...snap.data() };
        if (!q.approvalToken || q.approvalToken !== token) {
          setError("This approval link is invalid or has expired.");
          setLoading(false);
          return;
        }
        setQuote(q);
      } catch (e) {
        console.error(e);
        setError(e?.message || "Failed to load quote.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, token]);

  const createOrderIfMissing = async (q) => {
    if (q.orderId) return q.orderId;

    const lineItems = q.lineItems || [];
    const computedTotals = {
      costTotal: lineItems.reduce((a, li) => a + num(li?.calc?.breakdown?.costTotal, 0), 0),
      sellTotal: lineItems.reduce((a, li) => a + num(li?.calc?.breakdown?.sellTotal, 0), 0),
      itemCount: lineItems.length,
    };

    const orderNumber = makeDocNumber("WO");
    const payload = {
      orderNumber,
      status: "open",
      sourceQuoteId: q.id,
      quoteNumber: q.quoteNumber || "",
      clientId: q.clientId || "",
      clientSnapshot: q.clientSnapshot || null,
      lineItems,
      totals: q.totals || computedTotals,
      notes: q.notes || "",
      installJobId: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, "orders"), payload);

    await updateDoc(doc(db, "quotes", q.id), {
      orderId: ref.id,
      orderNumber,
      convertedToOrderAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return ref.id;
  };

  const respond = async (action) => {
    if (!quote) return;
    setBusy(true);
    try {
      if (action === "approve") {
        await updateDoc(doc(db, "quotes", quote.id), {
          status: "accepted",
          clientResponse: "approved",
          clientResponseMessage: reason || "",
          clientRespondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await createOrderIfMissing(quote);
        setSnack({ open: true, msg: "Quote approved. Thank you.", severity: "success" });
        setQuote((p) => ({ ...p, status: "accepted", clientResponse: "approved" }));
      }

      if (action === "changes") {
        await updateDoc(doc(db, "quotes", quote.id), {
          status: "changes_requested",
          clientResponse: "changes_requested",
          clientResponseMessage: reason || "",
          clientRespondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Change request sent.", severity: "success" });
        setQuote((p) => ({ ...p, status: "changes_requested", clientResponse: "changes_requested" }));
      }

      if (action === "reject") {
        await updateDoc(doc(db, "quotes", quote.id), {
          status: "rejected",
          clientResponse: "rejected",
          clientResponseMessage: reason || "",
          clientRespondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSnack({ open: true, msg: "Quote declined.", severity: "success" });
        setQuote((p) => ({ ...p, status: "rejected", clientResponse: "rejected" }));
      }
    } catch (e) {
      console.error(e);
      setSnack({ open: true, msg: e?.message || "Action failed", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Box sx={{ maxWidth: 1000, mx: "auto", p: 3 }}><Typography>Loading…</Typography></Box>;
  }

  if (error) {
    return <Box sx={{ maxWidth: 1000, mx: "auto", p: 3 }}><Alert severity="error">{error}</Alert></Box>;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto", p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h4" sx={{ fontWeight: 900 }}>
          Quote {quote?.quoteNumber || ""}
        </Typography>

        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Stack spacing={1}>
            <Typography sx={{ opacity: 0.8 }}>
              {quote?.clientSnapshot?.companyName || ""}
              {quote?.clientSnapshot?.contactName ? ` • ${quote.clientSnapshot.contactName}` : ""}
            </Typography>
            <Divider />
            {(quote?.lineItems || []).map((li) => (
              <Stack key={li.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                <Typography>{li.productName || "Item"} × {li.qty}</Typography>
                <Typography sx={{ fontWeight: 800 }}>{money(li?.calc?.breakdown?.sellTotal || 0)}</Typography>
              </Stack>
            ))}
            <Divider />
            <Stack direction="row" justifyContent="space-between">
              <Typography sx={{ fontWeight: 900 }}>Total</Typography>
              <Typography sx={{ fontWeight: 900 }}>{money(quote?.totals?.sellTotal || 0)}</Typography>
            </Stack>
            {quote?.notes ? (
              <>
                <Divider />
                <Typography sx={{ whiteSpace: "pre-wrap" }}>{quote.notes}</Typography>
              </>
            ) : null}
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 900 }}>Response</Typography>
            <TextField
              label="Comments (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button variant="contained" onClick={() => respond("approve")} disabled={busy} sx={{ textTransform: "none", fontWeight: 900 }}>
                Approve Quote
              </Button>
              <Button variant="outlined" onClick={() => respond("changes")} disabled={busy} sx={{ textTransform: "none", fontWeight: 800 }}>
                Request Changes
              </Button>
              <Button color="error" variant="outlined" onClick={() => respond("reject")} disabled={busy} sx={{ textTransform: "none", fontWeight: 800 }}>
                Reject
              </Button>
            </Stack>

            {quote?.status ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ opacity: 0.8 }}>Current status:</Typography>
                <Chip size="small" label={quote.status} />
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      </Stack>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((p) => ({ ...p, open: false }))}>
        <Alert severity={snack.severity} sx={{ width: "100%" }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
