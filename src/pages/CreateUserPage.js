import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/firebase';
import {
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore';

export default function CreateUserPage() {
  const history = useHistory();
  const { signup } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [shortName, setShortName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      // 🔍 Check shortName uniqueness
      const snap = await getDocs(
        query(collection(db, 'users'), where('shortName', '==', shortName.trim()))
      );
      if (!snap.empty) {
        setError('Short name already in use. Please choose another.');
        setCreating(false);
        return;
      }

      await signup(email.trim(), password, role, shortName.trim());
      history.push('/users');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box maxWidth={400} mx="auto" p={3}>
      <Typography variant="h5" gutterBottom>
        Create New User
      </Typography>
      {error && <Typography color="error">{error}</Typography>}

      <form onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          fullWidth
          margin="normal"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <TextField
          label="Password"
          type="password"
          fullWidth
          margin="normal"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        <TextField
          label="Short Name"
          fullWidth
          margin="normal"
          required
          value={shortName}
          onChange={e => setShortName(e.target.value)}
          helperText="Must be unique (e.g. initials or nickname)"
        />

        <FormControl fullWidth margin="normal">
          <InputLabel>Role</InputLabel>
          <Select
            value={role}
            label="Role"
            onChange={e => setRole(e.target.value)}
          >
            <MenuItem value="staff">Staff</MenuItem>
            <MenuItem value="manager">Manager</MenuItem>
          </Select>
        </FormControl>

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={creating}
          sx={{ mt: 2 }}
        >
          {creating ? 'Creating…' : 'Create User'}
        </Button>
      </form>
    </Box>
  );
}
