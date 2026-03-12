import React, { useEffect } from "react";
import { BrowserRouter as Router, Switch, Route, Redirect } from "react-router-dom";
import { CssBaseline } from "@mui/material";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ManagerRoute from "./components/ManagerRoute";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import ClientTypesPage from "./pages/ClientTypesPage";
import RateCardPage from "./pages/RateCardPage";
import MaterialsPage from "./pages/MaterialsPage";
import ProductsPage from "./pages/ProductsPage";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseOrderDetailPage from "./pages/PurchaseOrderDetailPage";

import QuotesPage from "./pages/QuotesPage";
import QuoteEditPage from "./pages/QuoteEditPage";

import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";

import LeadsPage from "./pages/LeadsPage";
import LeadDetailPage from "./pages/LeadDetailPage";

import ClientQuoteApprovalPage from "./pages/ClientQuoteApprovalPage";

import NotificationsPage from "./pages/NotificationsPage";
import UsersPage from "./pages/UsersPage";

import { ensureUserProfile } from "./utils/ensureUserProfile";

function AppRoutes() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.uid) return;

    ensureUserProfile(currentUser).catch((err) => {
      console.error("Failed to bootstrap user profile:", err);
    });
  }, [currentUser]);

  return (
    <Router>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route exact path="/quote-response/:id" component={ClientQuoteApprovalPage} />

        <ManagerRoute exact path="/notifications" component={NotificationsPage} />

        <ManagerRoute exact path="/dashboard" component={DashboardPage} />
        <ManagerRoute exact path="/users" component={UsersPage} />
        <ManagerRoute exact path="/suppliers" component={SuppliersPage} />
        <ManagerRoute exact path="/purchase-orders" component={PurchaseOrdersPage} />
        <ManagerRoute exact path="/purchase-orders/:id" component={PurchaseOrderDetailPage} />
        <ManagerRoute exact path="/rate-card" component={RateCardPage} />
        <ManagerRoute exact path="/materials" component={MaterialsPage} />
        <ManagerRoute exact path="/products" component={ProductsPage} />
        <ManagerRoute exact path="/client-types" component={ClientTypesPage} />
        <ManagerRoute exact path="/clients" component={ClientsPage} />
        <ManagerRoute exact path="/quotes" component={QuotesPage} />
        <ManagerRoute exact path="/quotes/:id" component={QuoteEditPage} />
        <ManagerRoute exact path="/leads" component={LeadsPage} />
        <ManagerRoute exact path="/leads/:id" component={LeadDetailPage} />
        <ManagerRoute exact path="/orders" component={OrdersPage} />
        <ManagerRoute exact path="/orders/:id" component={OrderDetailPage} />

        <Redirect to="/dashboard" />
      </Switch>
    </Router>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CssBaseline />
      <AppRoutes />
    </AuthProvider>
  );
}