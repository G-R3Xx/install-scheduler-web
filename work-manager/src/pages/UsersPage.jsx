import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import {
  collapseUsersForDisplay,
  ensureUserProfile,
  normalizeEmail,
  normalizeUserRecord,
  resolveCurrentUserProfile,
  roleRank,
} from "../utils/ensureUserProfile";

const MANAGER_ROLES = ["manager", "admin", "owner"];
const ROLE_OPTIONS = ["staff", "manager"];

const emptyForm = {
  firstName: "",
  lastName: "",
  displayName: "",
  shortName: "",
  email: "",
  role: "staff",
  status: "active",
};

function titleCase(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getUserName(user) {
  if (!user) return "";
  return (
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.shortName ||
    user.email ||
    "Unnamed user"
  );
}

function getInitialForm(user) {
  if (!user) return { ...emptyForm };

  return {
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    displayName: user.displayName || "",
    shortName: user.shortName || "",
    email: user.email || "",
    role: user.role || "staff",
    status: user.status || "active",
  };
}

export default function UsersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [rawUsers, setRawUsers] = useState([]);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });

  const authUser = auth.currentUser || null;

  const canManageUsers = useMemo(() => {
    return MANAGER_ROLES.includes(String(currentProfile?.role || "").toLowerCase());
  }, [currentProfile]);

  const duplicateInfo = useMemo(() => {
    const groups = new Map();

    for (const user of rawUsers) {
      const key =
        user.uid || user.authUid || user.emailLower || `doc:${user.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(user);
    }

    return Array.from(groups.values()).filter((group) => group.length > 1);
  }, [rawUsers]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const signedInUser = auth.currentUser;

      if (signedInUser) {
        await ensureUserProfile(signedInUser);
      }

      const snapshot = await getDocs(collection(db, "users"));
      const allUsers = snapshot.docs.map((snap) =>
        normalizeUserRecord(snap.id, snap.data())
      );

      const displayUsers = collapseUsersForDisplay(allUsers);
      const resolvedProfile = signedInUser
        ? resolveCurrentUserProfile(signedInUser, allUsers)
        : null;

      setRawUsers(allUsers);
      setUsers(displayUsers);
      setCurrentProfile(resolvedProfile || null);
    } catch (err) {
      console.error("Failed to load users:", err);
      setError(err?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setForm(getInitialForm(user));
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditingUser(null);
    setForm({ ...emptyForm });
  };

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;

    setForm((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "firstName" || field === "lastName") {
        const derivedName = [next.firstName, next.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();

        if (!next.displayName || next.displayName === [prev.firstName, prev.lastName].filter(Boolean).join(" ").trim()) {
          next.displayName = derivedName;
        }
      }

      return next;
    });
  };

  const handleSaveUser = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!canManageUsers) {
        throw new Error("Only managers can create or edit users.");
      }

      const emailLower = normalizeEmail(form.email);
      const shortName = String(form.shortName || "").trim();
      const displayName =
        String(form.displayName || "").trim() ||
        [form.firstName, form.lastName].filter(Boolean).join(" ").trim();

      if (!emailLower) {
        throw new Error("Email is required.");
      }

      if (!shortName) {
        throw new Error("Short name is required.");
      }

      const existingShortName = users.find(
        (user) =>
          user.shortName &&
          user.shortName.trim().toLowerCase() === shortName.toLowerCase() &&
          user.id !== editingUser?.id
      );

      if (existingShortName) {
        throw new Error("Short name must be unique.");
      }

      const payload = {
        firstName: String(form.firstName || "").trim(),
        lastName: String(form.lastName || "").trim(),
        displayName,
        shortName,
        email: String(form.email || "").trim(),
        emailLower,
        role: String(form.role || "staff").toLowerCase(),
        status: form.status || "active",
        updatedAt: serverTimestamp(),
      };

      if (editingUser) {
        await updateDoc(doc(db, "users", editingUser.id), payload);
        setSuccess("User updated.");
      } else {
        await addDoc(collection(db, "users"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setSuccess("User created.");
      }

      handleCloseDialog();
      await loadUsers();
    } catch (err) {
      console.error("Failed to save user:", err);
      setError(err?.message || "Failed to save user.");
    } finally {
      setSaving(false);
    }
  };

  const managerCount = users.filter((user) =>
    MANAGER_ROLES.includes(String(user.role || "").toLowerCase())
  ).length;

  const staffCount = users.filter(
    (user) => !MANAGER_ROLES.includes(String(user.role || "").toLowerCase())
  ).length;

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
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
          >
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <PeopleRoundedIcon />
                <Typography variant="h5" fontWeight={700}>
                  Users
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  icon={<ManageAccountsRoundedIcon />}
                  label={`Signed in as: ${titleCase(currentProfile?.role || "unknown")}`}
                  color={
                    MANAGER_ROLES.includes(String(currentProfile?.role || "").toLowerCase())
                      ? "success"
                      : "default"
                  }
                  variant="outlined"
                />

                <Chip label={`Total users: ${users.length}`} variant="outlined" />
                <Chip label={`Managers: ${managerCount}`} variant="outlined" />
                <Chip label={`Staff: ${staffCount}`} variant="outlined" />
              </Stack>

              {authUser && currentProfile && currentProfile.id !== authUser.uid && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Your manager profile is being resolved from the Firestore user record linked by email, not from a duplicate auth-UID staff record. That fixes the top role chip and permissions.
                </Alert>
              )}

              {!!duplicateInfo.length && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Duplicate user records were detected. The page is now collapsing them for display and using the strongest matching profile for permissions.
                </Alert>
              )}
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={loadUsers}
                disabled={loading || saving}
              >
                Refresh
              </Button>

              {canManageUsers && (
                <Button
                  variant="contained"
                  startIcon={<PersonAddAltRoundedIcon />}
                  onClick={handleOpenCreate}
                  disabled={loading || saving}
                >
                  Add User
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}

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
                    <TableCell>Name</TableCell>
                    <TableCell>Short Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Linked UID</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {users.map((user) => {
                    const isCurrentResolvedProfile =
                      user.id === currentProfile?.id;

                    return (
                      <TableRow key={user.id} hover>
                        <TableCell>
                          <Stack spacing={0.5}>
                            <Typography fontWeight={600}>
                              {getUserName(user)}
                            </Typography>

                            {isCurrentResolvedProfile && (
                              <Chip
                                size="small"
                                label="Current profile"
                                color="success"
                                variant="outlined"
                                sx={{ width: "fit-content" }}
                              />
                            )}
                          </Stack>
                        </TableCell>

                        <TableCell>{user.shortName || "—"}</TableCell>
                        <TableCell>{user.email || "—"}</TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            label={titleCase(user.role || "staff")}
                            color={
                              MANAGER_ROLES.includes(String(user.role || "").toLowerCase())
                                ? "success"
                                : "default"
                            }
                            variant="outlined"
                          />
                        </TableCell>

                        <TableCell>{titleCase(user.status || "active")}</TableCell>

                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                          {user.uid || user.authUid || "—"}
                        </TableCell>

                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<EditRoundedIcon />}
                            onClick={() => handleOpenEdit(user)}
                            disabled={!canManageUsers}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {!users.length && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Box sx={{ py: 5, textAlign: "center" }}>
                          <Typography color="text.secondary">
                            No users found.
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

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editingUser ? `Edit ${getUserName(editingUser)}` : "Add User"}
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="First Name"
              value={form.firstName}
              onChange={handleFieldChange("firstName")}
              fullWidth
            />

            <TextField
              label="Last Name"
              value={form.lastName}
              onChange={handleFieldChange("lastName")}
              fullWidth
            />

            <TextField
              label="Display Name"
              value={form.displayName}
              onChange={handleFieldChange("displayName")}
              fullWidth
            />

            <TextField
              label="Short Name"
              value={form.shortName}
              onChange={handleFieldChange("shortName")}
              fullWidth
              required
              helperText="Required and must be unique."
            />

            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={handleFieldChange("email")}
              fullWidth
              required
            />

            <FormControl fullWidth>
              <InputLabel id="role-label">Role</InputLabel>
              <Select
                labelId="role-label"
                value={form.role}
                label="Role"
                onChange={handleFieldChange("role")}
              >
                {ROLE_OPTIONS.map((role) => (
                  <MenuItem key={role} value={role}>
                    {titleCase(role)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="status-label">Status</InputLabel>
              <Select
                labelId="status-label"
                value={form.status}
                label="Status"
                onChange={handleFieldChange("status")}
              >
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="invited">Invited</MenuItem>
                <MenuItem value="disabled">Disabled</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSaveUser} variant="contained" disabled={saving}>
            {saving ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}