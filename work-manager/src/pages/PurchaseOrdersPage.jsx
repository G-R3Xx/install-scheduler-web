import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";

import {
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { normalizePurchaseOrderRecord } from "../utils/purchaseOrders";

const STATUS_OPTIONS = [
  "draft",
  "sent",
  "ordered",
  "part_received",
  "received",
  "cancelled",
];

function currency(value) {
  const parsed = Number(value || 0);
  return `$${parsed.toFixed(2)}`;
}

function statusChip(status) {
  const value = String(status || "draft").toLowerCase();
  const map = {
    draft: { label: "Draft", color: "default" },
    sent: { label: "Sent", color: "info" },
    ordered: { label: "Ordered", color: "primary" },
    part_received: { label: "Part Received", color: "warning" },
    received: { label: "Received", color: "success" },
    cancelled: { label: "Cancelled", color: "default" },
  };

  const config = map[value] || map.draft;

  return (
    <Chip
      label={config.label}
      color={config.color}
      size="small"
      variant="outlined"
    />
  );
}

export default function PurchaseOrdersPage() {
  const history = useHistory();
  const [loading, setLoading] = useState(true);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("draft");
  const [creating, setCreating] = useState(false);

  const handleCreatePurchaseOrder = async () => {
    setCreating(true);
    setError("");

    try {
      const docRef = await addDoc(collection(db, "purchaseOrders"), {
        poNumber: "",
        supplierId: "",
        supplierName: "",
        status: "draft",
        notes: "",
        sourceOrderIds: [],
        lines: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      history.push(`/purchase-orders/${docRef.id}`);
    } catch (err) {
      console.error("Failed to create purchase order:", err);
      setError(err?.message || "Failed to create purchase order.");
    } finally {
      setCreating(false);
    }
  };

  const loadPurchaseOrders = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const snapshot = await getDocs(collection(db, "purchaseOrders"));
      const rows = snapshot.docs.map((snap) =>
        normalizePurchaseOrderRecord(snap.id, snap.data())
      );

      rows.sort((a, b) => {
        const aTime = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
        const bTime = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
        return bTime - aTime;
      });

      setPurchaseOrders(rows);
    } catch (err) {
      console.error("Failed to load purchase orders:", err);
      setError(err?.message || "Failed to load purchase orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  const filteredOrders = useMemo(() => {
    const term = String(search || "").trim().toLowerCase();

    return purchaseOrders.filter((po) => {
      const matchesSearch =
        !term ||
        String(po.poNumber || "").toLowerCase().includes(term) ||
        String(po.supplierName || "").toLowerCase().includes(term) ||
        String(po.createdBy?.name || "").toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "all" || po.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [purchaseOrders, search, statusFilter]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", lg: "center" }}
          >
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <ReceiptLongRoundedIcon />
                <Typography variant="h5" fontWeight={700}>
                  Purchase Orders
                </Typography>
              </Stack>

              <Typography color="text.secondary">
                Draft and issued supplier purchase orders created from linked
                materials.
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  label={`Total: ${purchaseOrders.length}`}
                  variant="outlined"
                />
                <Chip
                  label={`Drafts: ${
                    purchaseOrders.filter((po) => po.status === "draft").length
                  }`}
                  variant="outlined"
                />
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={loadPurchaseOrders}
                disabled={loading}
              >
                Refresh
              </Button>

              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={handleCreatePurchaseOrder}
                disabled={creating}
                sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
              >
                {creating ? "Creating..." : "New Purchase Order"}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              label="Search purchase orders"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel id="po-status-filter-label">Status</InputLabel>
              <Select
                labelId="po-status-filter-label"
                value={statusFilter}
                label="Status"
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                {STATUS_OPTIONS.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Paper
          elevation={0}
          sx={{
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {loading ? (
            <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>PO Number</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Linked Orders</TableCell>
                    <TableCell>Lines</TableCell>
                    <TableCell>Total</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Open</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredOrders.map((po) => (
                    <TableRow
                      key={po.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => history.push(`/purchase-orders/${po.id}`)}
                    >
                      <TableCell>{po.poNumber || po.id}</TableCell>
                      <TableCell>{po.supplierName || "—"}</TableCell>
                      <TableCell>{po.sourceOrderIds?.length || 0}</TableCell>
                      <TableCell>{po.lines?.length || 0}</TableCell>
                      <TableCell>{currency(po.total)}</TableCell>
                      <TableCell>{statusChip(po.status)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          endIcon={<OpenInNewRoundedIcon />}
                          onClick={(event) => {
                            event.stopPropagation();
                            history.push(`/purchase-orders/${po.id}`);
                          }}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {!filteredOrders.length && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Box sx={{ py: 5, textAlign: "center" }}>
                          <Typography color="text.secondary">
                            No purchase orders found.
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Stack>
    </Box>
  );
}