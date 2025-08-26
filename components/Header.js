import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

export default function Header() {
  const { currentUser, logout } = useAuth();

  return (
    <header className="app-header">
      <h1 className="logo">Install Scheduler</h1>
      <nav>
        {currentUser && (
          <>
            <Link to="/">Jobs</Link>
            {currentUser.role === 'manager' && <Link to="/users">Manage Users</Link>}
            <button onClick={logout} className="logout-btn">Log Out</button>
          </>
        )}
        {!currentUser && <Link to="/login">Log In</Link>}
      </nav>
    </header>
  );
}
