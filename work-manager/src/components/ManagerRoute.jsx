import React from "react";
import { Redirect, Route } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useAuth } from "../contexts/AuthContext";
import AppShell from "./AppShell";

export default function ManagerRoute({ component: Component, ...rest }) {
  const { user, loading, role } = useAuth();

  return (
    <Route
      {...rest}
      render={(props) => {
        if (loading) {
          return (
            <Box
              sx={{
                minHeight: "60vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress />
            </Box>
          );
        }

        if (!user) return <Redirect to="/login" />;

        if (role !== "manager") {
          return (
            <Box sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
                Access denied
              </Typography>
              <Typography>You must be a manager to use Work Manager.</Typography>
            </Box>
          );
        }

        return (
          <AppShell>
            <Component {...props} />
          </AppShell>
        );
      }}
    />
  );
}