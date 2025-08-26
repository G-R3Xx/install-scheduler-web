// src/App.js
import React from 'react';
import { BrowserRouter as Router, Switch, Route, Link } from 'react-router-dom';
import SiteSurveyPage from './pages/SiteSurveyPage';

function App() {
  return (
    <Router>
      <Switch>
        <Route path="/survey/new" component={SiteSurveyPage} />
        <Route path="/" exact>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <h1>Install Scheduler</h1>
            <p>Welcome to the app. Navigate below:</p>
            <Link to="/survey/new">Go to Site Survey</Link>
          </div>
        </Route>
      </Switch>
    </Router>
  );
}

export default App;
