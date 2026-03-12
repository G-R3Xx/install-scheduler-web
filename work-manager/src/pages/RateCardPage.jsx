import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { db } from "../firebase/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

function num(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export default function RateCardPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [labourPerHour, setLabourPerHour] = useState(120);
  const [labourBlockMinutes, setLabourBlockMinutes] = useState(5);
  const [inkPerM2, setInkPerM2] = useState(10);
  const [markupPct, setMarkupPct] = useState(50);

  // NEW
  const [profitMarginPct, setProfitMarginPct] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const ref = doc(db, "rateCards", "default");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          await setDoc(ref, {
            labourPerHour: 120,
            labourBlockMinutes: 5,
            inkPerM2: 10,
            markupPct: 50,
            profitMarginPct: 0,
            updatedAt: serverTimestamp(),
          });

          setLabourPerHour(120);
          setLabourBlockMinutes(5);
          setInkPerM2(10);
          setMarkupPct(50);
          setProfitMarginPct(0);
        } else {
          const d = snap.data() || {};
          setLabourPerHour(num(d.labourPerHour, 120));
          setLabourBlockMinutes(num(d.labourBlockMinutes, 5));
          setInkPerM2(num(d.inkPerM2, 10));
          setMarkupPct(num(d.markupPct, 50));
          setProfitMarginPct(num(d.profitMarginPct, 0));
        }
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load rate card");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const ref = doc(db, "rateCards", "default");
      await setDoc(
        ref,
        {
          labourPerHour: num(labourPerHour, 0),
          labourBlockMinutes: Math.max(1, Math.floor(num(labourBlockMinutes, 5))),
          inkPerM2: num(inkPerM2, 0),
          markupPct: num(markupPct, 0),
          profitMarginPct: num(profitMarginPct, 0),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 900, mx: "auto" }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 0.5 }}>
        Rate Card
      </Typography>
      <Typography sx={{ opacity: 0.8, mb: 2 }}>
        Global defaults used when pricing products & quote items.
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper sx={{ p: 2.5, borderRadius: 3 }}>
        <Stack spacing={2}>
          <TextField
            label="Labour ($ per hour)"
            value={labourPerHour}
            onChange={(e) => setLabourPerHour(e.target.value)}
            disabled={loading}
          />

          <TextField
            label="Labour block minutes"
            value={labourBlockMinutes}
            onChange={(e) => setLabourBlockMinutes(e.target.value)}
            disabled={loading}
            helperText="Labour is rounded up to this block size (e.g. 5 min)."
          />

          <TextField
            label="Ink ($ per m²)"
            value={inkPerM2}
            onChange={(e) => setInkPerM2(e.target.value)}
            disabled={loading}
          />

          <TextField
            label="Markup (%)"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
            disabled={loading}
            helperText="Markup is applied to cost (cost × (1+markup))."
          />

          <TextField
            label="Profit margin (%)"
            value={profitMarginPct}
            onChange={(e) => setProfitMarginPct(e.target.value)}
            disabled={loading}
            helperText="Added on top of markup (sell = cost × (1+markup) × (1+profit margin))."
          />

          <Box>
            <Button
              variant="contained"
              onClick={save}
              disabled={loading || saving}
              sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
            >
              {saving ? "Saving…" : "Save Rate Card"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
