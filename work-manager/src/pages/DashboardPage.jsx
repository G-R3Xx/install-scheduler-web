import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";

import WorkOutlineRoundedIcon from "@mui/icons-material/WorkOutlineRounded";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import RequestQuoteRoundedIcon from "@mui/icons-material/RequestQuoteRounded";
import BuildCircleRoundedIcon from "@mui/icons-material/BuildCircleRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";

import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";

function textValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function joinTexts(...values) {
  return values
    .flat()
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v).toLowerCase())
    .join(" ");
}

function hasAny(text, keywords = []) {
  const haystack = textValue(text);
  return keywords.some((word) => haystack.includes(word.toLowerCase()));
}

function toDateSafe(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }

  if (value?.seconds) {
    try {
      return new Date(value.seconds * 1000);
    } catch {
      return null;
    }
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const date = toDateSafe(value);
  if (!date) return "—";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  const date = toDateSafe(value);
  if (!date) return "—";
  return date.toLocaleString();
}

function getOrderCombinedText(order) {
  const tasksText = Array.isArray(order?.tasks)
    ? order.tasks
        .map((task) =>
          joinTexts(
            task?.title,
            task?.name,
            task?.status,
            task?.state,
            task?.type
          )
        )
        .join(" ")
    : "";

  return joinTexts(
    order?.status,
    order?.workflowStatus,
    order?.orderStatus,
    order?.productionStatus,
    order?.stage,
    order?.currentStage,
    order?.artworkStatus,
    order?.proofStatus,
    order?.approvalStatus,
    order?.installStatus,
    order?.invoiceStatus,
    order?.accountsStatus,
    tasksText
  );
}

function getQuoteCombinedText(quote) {
  return joinTexts(
    quote?.status,
    quote?.quoteStatus,
    quote?.approvalStatus,
    quote?.stage
  );
}

function isOpenOrder(order) {
  if (!order) return false;
  const text = getOrderCombinedText(order);

  if (order?.archived === true) return false;
  if (order?.completed === true) return false;

  if (
    hasAny(text, [
      "completed",
      "complete",
      "closed",
      "archived",
      "cancelled",
      "canceled",
      "paid",
    ])
  ) {
    return false;
  }

  return true;
}

function isAwaitingArtwork(order) {
  if (!order) return false;

  const text = getOrderCombinedText(order);

  if (!isOpenOrder(order)) return false;

  const positiveMatch =
    hasAny(text, [
      "awaiting artwork",
      "artwork required",
      "proof required",
      "proof pending",
      "proof sent",
      "await proof",
      "awaiting proof",
      "await client proof approval",
      "revision requested",
      "revise artwork",
      "client feedback",
      "artwork",
      "proof",
    ]) || order?.needsArtwork === true;

  const finishedMatch = hasAny(text, [
    "artwork approved",
    "proof approved",
    "approved",
  ]);

  return positiveMatch && !finishedMatch;
}

function isPendingInstall(order) {
  if (!order) return false;

  const text = getOrderCombinedText(order);

  if (!isOpenOrder(order)) return false;

  const installRelated = hasAny(text, [
    "pending install",
    "install booked",
    "awaiting install",
    "install scheduled",
    "install",
  ]);

  const completedInstall = hasAny(text, [
    "install complete",
    "installed",
    "installation complete",
  ]);

  return installRelated && !completedInstall;
}

function needsInvoice(order) {
  if (!order) return false;

  const text = getOrderCombinedText(order);

  if (hasAny(text, ["invoice sent", "invoiced", "paid"])) {
    return false;
  }

  if (
    hasAny(text, [
      "invoice to send",
      "ready to invoice",
      "awaiting invoice",
      "invoice pending",
      "to invoice",
    ])
  ) {
    return true;
  }

  return (
    hasAny(text, ["completed", "complete", "install complete", "installed"]) &&
    !hasAny(text, ["invoice sent", "invoiced", "paid"])
  );
}

function isAwaitingQuote(quote) {
  if (!quote) return false;

  const text = getQuoteCombinedText(quote);

  if (
    hasAny(text, [
      "accepted",
      "approved",
      "declined",
      "rejected",
      "converted",
      "won",
      "lost",
      "expired",
      "cancelled",
      "canceled",
    ])
  ) {
    return false;
  }

  return hasAny(text, [
    "draft",
    "pending",
    "sent",
    "awaiting",
    "open",
    "quote",
  ]);
}

function getOrderDisplayTitle(order) {
  return (
    order?.jobName ||
    order?.title ||
    order?.orderName ||
    order?.clientName ||
    order?.companyName ||
    order?.contactName ||
    "Untitled Order"
  );
}

function getOrderDisplaySubtitle(order) {
  return (
    order?.clientName ||
    order?.companyName ||
    order?.description ||
    order?.status ||
    "—"
  );
}

function getOrderUpdatedAt(order) {
  return (
    order?.updatedAt ||
    order?.modifiedAt ||
    order?.lastUpdated ||
    order?.createdAt ||
    null
  );
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "short" });
}

function buildLastSixMonthsData(orders, quotes) {
  const now = new Date();
  const months = [];

  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: getMonthKey(d),
      label: getMonthLabel(d),
      orders: 0,
      quotes: 0,
    });
  }

  const monthMap = new Map(months.map((m) => [m.key, m]));

  orders.forEach((order) => {
    const date = toDateSafe(order?.createdAt || order?.updatedAt);
    if (!date) return;
    const key = getMonthKey(new Date(date.getFullYear(), date.getMonth(), 1));
    if (monthMap.has(key)) {
      monthMap.get(key).orders += 1;
    }
  });

  quotes.forEach((quote) => {
    const date = toDateSafe(quote?.createdAt || quote?.updatedAt);
    if (!date) return;
    const key = getMonthKey(new Date(date.getFullYear(), date.getMonth(), 1));
    if (monthMap.has(key)) {
      monthMap.get(key).quotes += 1;
    }
  });

  return months;
}

function StatCard({ title, value, subtitle, icon, color = "#1976d2" }) {
  const theme = useTheme();

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.25,
        borderRadius: 4,
        border: "1px solid",
        borderColor: alpha(color, 0.25),
        background: `linear-gradient(135deg, ${alpha(color, 0.16)} 0%, ${alpha(
          color,
          0.06
        )} 100%)`,
        minHeight: 150,
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              color: theme.palette.text.secondary,
              mb: 1,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            {title}
          </Typography>

          <Typography
            variant="h2"
            sx={{
              fontWeight: 800,
              lineHeight: 1,
              mb: 1,
              color,
              fontSize: { xs: "2.3rem", md: "3rem" },
            }}
          >
            {value}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>

        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 3,
            display: "grid",
            placeItems: "center",
            backgroundColor: alpha(color, 0.14),
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
}

function SectionCard({ title, subtitle, children, icon }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        borderRadius: 4,
        border: "1px solid",
        borderColor: "divider",
        height: "100%",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {icon ? <Box color="text.secondary">{icon}</Box> : null}
      </Stack>

      {children}
    </Paper>
  );
}

function MiniBarChart({ data }) {
  const theme = useTheme();
  const maxValue = Math.max(
    ...data.map((item) => Math.max(item.orders, item.quotes)),
    1
  );

  return (
    <Stack spacing={2}>
      {data.map((item) => (
        <Box key={item.key}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 0.75 }}
          >
            <Typography variant="body2" fontWeight={600}>
              {item.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.orders} orders / {item.quotes} quotes
            </Typography>
          </Stack>

          <Stack spacing={0.75}>
            <Box
              sx={{
                height: 12,
                borderRadius: 999,
                overflow: "hidden",
                backgroundColor: alpha(theme.palette.primary.main, 0.1),
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${(item.orders / maxValue) * 100}%`,
                  borderRadius: 999,
                  backgroundColor: "primary.main",
                  transition: "width 0.3s ease",
                }}
              />
            </Box>

            <Box
              sx={{
                height: 12,
                borderRadius: 999,
                overflow: "hidden",
                backgroundColor: alpha(theme.palette.secondary.main, 0.1),
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${(item.quotes / maxValue) * 100}%`,
                  borderRadius: 999,
                  backgroundColor: "secondary.main",
                  transition: "width 0.3s ease",
                }}
              />
            </Box>
          </Stack>
        </Box>
      ))}

      <Stack direction="row" spacing={2} sx={{ pt: 0.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: 999,
              bgcolor: "primary.main",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Orders
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: 999,
              bgcolor: "secondary.main",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Quotes
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

function ProgressRow({ label, value, max, color }) {
  const width = max > 0 ? (value / max) * 100 : 0;

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 0.75 }}
      >
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {value}
        </Typography>
      </Stack>

      <Box
        sx={{
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
          bgcolor: alpha(color, 0.12),
        }}
      >
        <Box
          sx={{
            width: `${width}%`,
            height: "100%",
            borderRadius: 999,
            bgcolor: color,
            transition: "width 0.3s ease",
          }}
        />
      </Box>
    </Box>
  );
}

export default function DashboardPage() {
  const theme = useTheme();

  const [orders, setOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubOrders = onSnapshot(
      collection(db, "orders"),
      (snapshot) => {
        const rows = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setOrders(rows);
        setOrdersLoaded(true);
      },
      (err) => {
        console.error("Failed to load orders:", err);
        setError("Failed to load dashboard order data.");
        setOrdersLoaded(true);
      }
    );

    const unsubQuotes = onSnapshot(
      collection(db, "quotes"),
      (snapshot) => {
        const rows = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setQuotes(rows);
        setQuotesLoaded(true);
      },
      (err) => {
        console.error("Failed to load quotes:", err);
        setError("Failed to load dashboard quote data.");
        setQuotesLoaded(true);
      }
    );

    return () => {
      unsubOrders();
      unsubQuotes();
    };
  }, []);

  useEffect(() => {
    if (ordersLoaded && quotesLoaded) {
      setLoading(false);
    }
  }, [ordersLoaded, quotesLoaded]);

  const metrics = useMemo(() => {
    const openJobs = orders.filter(isOpenOrder).length;
    const awaitingArtwork = orders.filter(isAwaitingArtwork).length;
    const awaitingQuotes = quotes.filter(isAwaitingQuote).length;
    const pendingInstall = orders.filter(isPendingInstall).length;
    const invoicesToSend = orders.filter(needsInvoice).length;

    return {
      openJobs,
      awaitingArtwork,
      awaitingQuotes,
      pendingInstall,
      invoicesToSend,
    };
  }, [orders, quotes]);

  const chartData = useMemo(() => buildLastSixMonthsData(orders, quotes), [orders, quotes]);

  const workflowRows = useMemo(() => {
    return [
      {
        label: "Open Jobs",
        value: metrics.openJobs,
        color: theme.palette.primary.main,
      },
      {
        label: "Awaiting Artwork",
        value: metrics.awaitingArtwork,
        color: theme.palette.warning.main,
      },
      {
        label: "Awaiting Quotes",
        value: metrics.awaitingQuotes,
        color: theme.palette.info.main,
      },
      {
        label: "Pending Install",
        value: metrics.pendingInstall,
        color: theme.palette.success.main,
      },
      {
        label: "Invoices To Send",
        value: metrics.invoicesToSend,
        color: theme.palette.secondary.main,
      },
    ];
  }, [metrics, theme]);

  const workflowMax = Math.max(...workflowRows.map((row) => row.value), 1);

  const recentOrders = useMemo(() => {
    return [...orders]
      .sort((a, b) => {
        const aDate = toDateSafe(getOrderUpdatedAt(a))?.getTime() || 0;
        const bDate = toDateSafe(getOrderUpdatedAt(b))?.getTime() || 0;
        return bDate - aDate;
      })
      .slice(0, 8);
  }, [orders]);

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "60vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">Loading dashboard…</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={800}>
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Live overview of your current workload, approvals and next actions.
        </Typography>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            xl: "repeat(5, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 3,
        }}
      >
        <StatCard
          title="Open Jobs"
          value={metrics.openJobs}
          subtitle="All active orders still in progress"
          icon={<WorkOutlineRoundedIcon />}
          color={theme.palette.primary.main}
        />

        <StatCard
          title="Awaiting Artwork"
          value={metrics.awaitingArtwork}
          subtitle="Proofs, revisions and artwork approvals"
          icon={<DrawRoundedIcon />}
          color={theme.palette.warning.main}
        />

        <StatCard
          title="Awaiting Quotes"
          value={metrics.awaitingQuotes}
          subtitle="Drafted, sent or still pending response"
          icon={<RequestQuoteRoundedIcon />}
          color={theme.palette.info.main}
        />

        <StatCard
          title="Pending Install"
          value={metrics.pendingInstall}
          subtitle="Jobs not yet installed or completed"
          icon={<BuildCircleRoundedIcon />}
          color={theme.palette.success.main}
        />

        <StatCard
          title="Invoices To Send"
          value={metrics.invoicesToSend}
          subtitle="Completed work still needing invoicing"
          icon={<ReceiptLongRoundedIcon />}
          color={theme.palette.secondary.main}
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
          gap: 2,
          mb: 3,
        }}
      >
        <SectionCard
          title="Activity Trend"
          subtitle="Orders and quotes over the last 6 months"
          icon={<TrendingUpRoundedIcon />}
        >
          <MiniBarChart data={chartData} />
        </SectionCard>

        <SectionCard
          title="Workflow Snapshot"
          subtitle="Where the current workload is sitting"
          icon={<ScheduleRoundedIcon />}
        >
          <Stack spacing={2}>
            {workflowRows.map((row) => (
              <ProgressRow
                key={row.label}
                label={row.label}
                value={row.value}
                max={workflowMax}
                color={row.color}
              />
            ))}
          </Stack>
        </SectionCard>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr" },
          gap: 2,
        }}
      >
        <SectionCard
          title="Recent Jobs"
          subtitle="Most recently updated orders"
          icon={<WorkOutlineRoundedIcon />}
        >
          {recentOrders.length === 0 ? (
            <Typography color="text.secondary">No recent jobs found.</Typography>
          ) : (
            <Stack spacing={1.25}>
              {recentOrders.map((order) => {
                const statusText =
                  order?.status ||
                  order?.workflowStatus ||
                  order?.orderStatus ||
                  order?.productionStatus ||
                  "No status";

                return (
                  <Paper
                    key={order.id}
                    elevation={0}
                    sx={{
                      p: 1.5,
                      borderRadius: 3,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", md: "center" }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700}>
                          {getOrderDisplayTitle(order)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {getOrderDisplaySubtitle(order)}
                        </Typography>
                      </Box>

                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        alignItems={{ xs: "flex-start", sm: "center" }}
                      >
                        <Chip
                          size="small"
                          label={statusText}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          Updated: {formatDateTime(getOrderUpdatedAt(order))}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </SectionCard>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 4,
            border: "1px dashed",
            borderColor: "divider",
            backgroundColor: alpha(theme.palette.info.main, 0.04),
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Status matching is currently keyword-based so it works with mixed data while you’re still shaping the workflow.
            Once your order and quote statuses are locked down, I’d tighten this to exact status enums for even cleaner counts.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}