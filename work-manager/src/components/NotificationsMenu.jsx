import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import { db } from "../firebase/firebase";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

function formatTs(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

export default function NotificationsMenu() {
  const history = useHistory();
  const [anchorEl, setAnchorEl] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const qy = query(
      collection(db, "notifications"),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Notifications load failed:", err);
      }
    );

    return () => unsub();
  }, []);

  const unreadCount = useMemo(
    () => items.filter((n) => n.isRead !== true).length,
    [items]
  );

  const open = Boolean(anchorEl);

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const openNotification = async (n) => {
    try {
      if (n.isRead !== true) {
        await updateDoc(doc(db, "notifications", n.id), { isRead: true });
      }
    } catch (e) {
      console.error("Failed to mark notification read:", e);
    }

    handleClose();

    if (n.route) {
      history.push(n.route);
    }
  };

  const markAllRead = async () => {
    const unread = items.filter((n) => n.isRead !== true);
    try {
      await Promise.all(
        unread.map((n) =>
          updateDoc(doc(db, "notifications", n.id), { isRead: true })
        )
      );
    } catch (e) {
      console.error("Failed to mark all notifications read:", e);
    }
  };

  return (
    <>
      <IconButton color="inherit" onClick={handleOpen}>
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsRoundedIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{ sx: { width: 420, maxWidth: "95vw", borderRadius: 3 } }}
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography sx={{ fontWeight: 900 }}>Notifications</Typography>

            <Button
              size="small"
              startIcon={<DoneAllRoundedIcon />}
              onClick={markAllRead}
              sx={{ textTransform: "none" }}
            >
              Mark all read
            </Button>
          </Stack>

          <Typography sx={{ opacity: 0.7, fontSize: 13 }}>
            {unreadCount} unread
          </Typography>
        </Box>

        <Divider />

        {items.length === 0 ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Typography sx={{ opacity: 0.7 }}>
              No notifications yet.
            </Typography>
          </Box>
        ) : (
          items.map((n) => (
            <MenuItem
              key={n.id}
              onClick={() => openNotification(n)}
              sx={{
                alignItems: "flex-start",
                py: 1.5,
                px: 2,
                borderLeft:
                  n.isRead === true ? "4px solid transparent" : "4px solid #1976d2",
                whiteSpace: "normal",
              }}
            >
              <Box sx={{ width: "100%" }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mb: 0.5, flexWrap: "wrap" }}
                >
                  <Typography sx={{ fontWeight: 800 }}>
                    {n.title || "Notification"}
                  </Typography>

                  {n.isRead !== true ? (
                    <Chip size="small" label="New" color="primary" />
                  ) : null}
                </Stack>

                {n.body ? (
                  <Typography sx={{ opacity: 0.82, mb: 0.5, whiteSpace: "pre-wrap" }}>
                    {n.body}
                  </Typography>
                ) : null}

                <Typography sx={{ opacity: 0.6, fontSize: 12 }}>
                  {formatTs(n.createdAt)}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}