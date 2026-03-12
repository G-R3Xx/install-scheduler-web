import React from "react";
import { Link as RouterLink, useHistory, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";

import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import BusinessRoundedIcon from "@mui/icons-material/BusinessRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import WidgetsRoundedIcon from "@mui/icons-material/WidgetsRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import CategoryRoundedIcon from "@mui/icons-material/CategoryRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import StoreRoundedIcon from "@mui/icons-material/StoreRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import NotificationsMenu from "./NotificationsMenu";
import { useAuth } from "../contexts/AuthContext";

const drawerWidth = 240;
const logoSrc = "/brand/tender-edge-logo.png";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: <DashboardRoundedIcon /> },
  { label: "Users", path: "/users", icon: <GroupRoundedIcon /> },
  { label: "Rate Card", path: "/rate-card", icon: <TuneRoundedIcon /> },
  { label: "Suppliers", path: "/suppliers", icon: <StoreRoundedIcon /> },
  { label: "Purchase Orders", path: "/purchase-orders", icon: <LocalShippingRoundedIcon /> },
  { label: "Materials", path: "/materials", icon: <Inventory2RoundedIcon /> },
  { label: "Products", path: "/products", icon: <WidgetsRoundedIcon /> },
  { label: "Client Types", path: "/client-types", icon: <CategoryRoundedIcon /> },
  { label: "Clients", path: "/clients", icon: <BusinessRoundedIcon /> },
  { label: "Leads", path: "/leads", icon: <SupportAgentRoundedIcon /> },
  { label: "Quotes", path: "/quotes", icon: <ReceiptLongRoundedIcon /> },
  { label: "Orders", path: "/orders", icon: <AssignmentRoundedIcon /> },
];

export default function AppShell({ children }) {
  const { profile, logout } = useAuth();
  const history = useHistory();
  const location = useLocation();

  const isActive = (path) =>
  location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = async () => {
    await logout();
    history.replace("/login");
  };

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", backgroundColor: "background.default" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: 0.2 }}>
            Work Manager
          </Typography>

          <Box sx={{ flex: 1 }} />

          <NotificationsMenu />

          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            {profile?.shortName || profile?.displayName || profile?.email || ""}
          </Typography>

          <Button
            color="inherit"
            startIcon={<LogoutRoundedIcon />}
            onClick={handleLogout}
            sx={{ textTransform: "none" }}
          >
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: "border-box" },
        }}
      >
        <Toolbar />

        <Box sx={{ px: 1.5, pt: 2, pb: 1 }}>
          <Box
            component="img"
            src={logoSrc}
            alt="Tender Edge"
            sx={{
              width: "100%",
              height: "auto",
              maxWidth: 180,
              display: "block",
              mx: "auto",
              mb: 1.5,
            }}
          />

          <Typography sx={{ px: 0.5, pb: 1, fontWeight: 800, opacity: 0.85 }}>
            Office
          </Typography>

          <List sx={{ pt: 0 }}>
            {navItems.map((item) => (
              <ListItemButton
                key={item.path}
                component={RouterLink}
                to={item.path}
                selected={isActive(item.path)}
                sx={{ borderRadius: 2, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>

          <Divider sx={{ my: 1.5 }} />

          <Button
            fullWidth
            variant="outlined"
            component="a"
            href="https://install-scheduler.web.app"
            target="_blank"
            rel="noreferrer"
            sx={{
              textTransform: "none",
              borderRadius: 2,
            }}
          >
            Open Installs App
          </Button>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flex: 1, p: 3 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}