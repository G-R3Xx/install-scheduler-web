// src/pages/ManageUsersPage.js
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  MenuItem,
  Button,
  List,
  ListItem,
  ListItemText,
  Select,
  FormControl,
  InputLabel,
  CircularProgress
} from '@mui/material';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  setDoc,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebase';
import { useAuth } from '../contexts/AuthContext';

export default function ManageUsersPage() {
  const { currentUser, userProfile } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // new user form state
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [newShortName, setNewShortName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!userProfile || userProfile.role !== 'manager') return;

    const unsub = onSnapshot(
      collection(db, 'users'),
      snap => {
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [userProfile]);

  const handleCreate = async e => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      // check shortName uniqueness
      const shortSnap = await getDocs(
        query(collection(db, 'users'), where('shortName', '==', newShortName.trim()))
      );
      if (!shortSnap.empty) {
        setError('Short name already in use. Please choose another.');
        setCreating(false);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, newEmail, newPass);
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: newEmail.trim(),
        role: newRole,
        shortName: newShortName.trim()
      });

      setNewEmail('');
      setNewPass('');
      setNewRole('staff');
      setNewShortName('');
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (uid, role) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role });
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const handleShortNameChange = async (uid, newVal) => {
    const trimmed = newVal.trim();
    if (!trimmed) return;

    // check uniqueness
    const conflict = users.find(u => u.shortName === trimmed && u.id !== uid);
    if (conflict) {
      alert('Short name already in use.');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', uid), { shortName: trimmed });
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (userProfile.role !== 'manager') {
    return (
      <Box p={3}>
        <Typography color="error">Access denied.</Typography>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Manage Users
      </Typography>

      {/* Create user form */}
      <Paper sx={{ p: 2, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Create New User
        </Typography>
        {error && <Typography color="error">{error}</Typography>}
        <Box
          component="form"
          onSubmit={handleCreate}
          sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <TextField
            label="Email"
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            required
          />
          <TextField
            label="Password"
            type="password"
            value={newPass}
            onChange={e => setNewPass(e.target.value)}
            required
          />
          <TextField
            label="Short Name"
            value={newShortName}
            onChange={e => setNewShortName(e.target.value)}
            required
            helperText="Must be unique"
          />
          <FormControl>
            <InputLabel>Role</InputLabel>
            <Select
              label="Role"
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
            >
              <MenuItem value="staff">Staff</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
            </Select>
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </Box>
      </Paper>

      {/* Existing users list */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Existing Users
        </Typography>
        <List>
          {users.map(user => (
            <ListItem key={user.id} divider sx={{ flexWrap: 'wrap', gap: 2 }}>
              <ListItemText
                primary={`${user.email} (${user.shortName || 'No short name'})`}
                secondary={`Role: ${user.role}`}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Short Name"
                value={user.shortName || ''}
                onChange={e => handleShortNameChange(user.id, e.target.value)}
                size="small"
              />
              <FormControl sx={{ minWidth: 120 }}>
                <Select
                  value={user.role}
                  onChange={e => handleRoleChange(user.id, e.target.value)}
                >
                  <MenuItem value="staff">Staff</MenuItem>
                  <MenuItem value="manager">Manager</MenuItem>
                </Select>
              </FormControl>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
}
