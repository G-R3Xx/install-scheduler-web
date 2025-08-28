// src/App.js
import React from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import Header from './components/Header';
import { useAuth } from './contexts/AuthContext';
import JobListPage from './pages/JobListPage';
import CreateJobPage from './pages/CreateJobPage';
import JobDetailPage from './pages/JobDetailPage';
import LoginPage from './pages/LoginPage';
import ManageUsersPage from './pages/ManageUsersPage';
import JobEditPage from './pages/JobEditPage';
import OhsFormPage from './pages/OhsFormPage';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import SplashScreen from './components/SplashScreen';
import SiteSurveyPage from './pages/SiteSurveyPage';

function RequireAuth({ children }) {
  const { currentUser } = useAuth();
  return currentUser ? children : <Redirect to="/login" />;
}

function AppRoutes() {
  return (
    <Switch>
      {/* Public */}
      <Route exact path="/login">
        <LoginPage />
      </Route>

      {/* Protected */}
      <Route exact path="/">
        <RequireAuth>
          <JobListPage />
        </RequireAuth>
      </Route>

      <Route exact path="/jobs/new">
        <RequireAuth>
          <CreateJobPage />
        </RequireAuth>
      </Route>

      <Route exact path="/jobs/:jobId/edit">
        <RequireAuth>
          <JobEditPage />
        </RequireAuth>
      </Route>

      <Route exact path="/jobs/:jobId">
        <RequireAuth>
          <JobDetailPage />
        </RequireAuth>
      </Route>

      <Route exact path="/users">
        <RequireAuth>
          <ManageUsersPage />
        </RequireAuth>
      </Route>

      <Route exact path="/jobs/:jobId/ohs">
        <RequireAuth>
          <OhsFormPage />
        </RequireAuth>
      </Route>

<Route path="/surveys/new" component={SiteSurveyPage} />
      {/* Fallback */}
      <Redirect to="/" />
    </Switch>
  );
}

export default function App() {
  const { loadingAuth } = useAuth();

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      {loadingAuth ? (
        <SplashScreen />
      ) : (
        <Router>
          <Header />
          <div style={{ minHeight: '100vh', background: '#0f172a10' /* soft bg to avoid white */ }}>
            <AppRoutes />
          </div>
        </Router>
      )}
    </LocalizationProvider>
  );
}
