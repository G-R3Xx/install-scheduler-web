import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button
} from '@mui/material';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';

export default function UsersListPage() {
  const history = useHistory();
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        User Management
      </Typography>

      <Button
        variant="contained"
        onClick={() => history.push('/users/new')}
        sx={{ mb: 2 }}
      >
        Create New User
      </Button>

      <Grid container spacing={2}>
        {users.length > 0 ? users.map(u => (
          <Grid item xs={12} md={6} key={u.id}>
            <Card variant="outlined">
              <CardContent>
                <Typography>
                  <strong>Email:</strong> {u.email}
                </Typography>
                <Typography>
                  <strong>Short Name:</strong> {u.shortName || '[Not set]'}
                </Typography>
                <Typography>
                  <strong>Role:</strong> {u.role}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )) : (
          <Typography>No users found.</Typography>
        )}
      </Grid>
    </Box>
  );
}
