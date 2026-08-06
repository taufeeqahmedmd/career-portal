import React from "react";
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { setActiveApplicantId } from "./admin/applicantSession";
import Home from "./pages/Home";
import { AuthProvider } from "./admin/AuthContext";
import ProtectedRoute, { PermissionRoute } from "./admin/ProtectedRoute";
import AdminLayout from "./admin/AdminLayout";
import AdminLogin from "./admin/pages/AdminLogin";
import ChangePasswordPage from "./admin/pages/ChangePasswordPage";
import DashboardPage from "./admin/pages/DashboardPage";
import ApplicationsPage from "./admin/pages/ApplicationsPage";
import ApplicantProfilePage from "./admin/pages/ApplicantProfilePage";
import OpeningsPage from "./admin/pages/OpeningsPage";
import BranchesPage from "./admin/pages/BranchesPage";
import UsersPage from "./admin/pages/UsersPage";
import RolesPage from "./admin/pages/RolesPage";
import EntitiesPage from "./admin/pages/EntitiesPage";
import ReportsPage from "./admin/pages/ReportsPage";
import FlowConfigPage from "./admin/pages/FlowConfigPage";

// Bookmarks of the old /admin/applications/:id URLs keep working
const LegacyApplicantRedirect = () => {
  const { id } = useParams();
  setActiveApplicantId(id);
  return <Navigate to="/admin/applicant-profile" replace />;
};

const App = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:entitySlug" element={<Home />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        {/* Outside the shell on purpose: reachable while the account is still
            locked to its initial password, and usable voluntarily afterwards */}
        <Route path="/admin/change-password" element={<ChangePasswordPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route
            path="applications"
            element={
              <PermissionRoute permission="applications.view">
                <ApplicationsPage />
              </PermissionRoute>
            }
          />
          {/* The applicant id travels in session state, not the URL */}
          <Route
            path="applicant-profile"
            element={
              <PermissionRoute permission="applications.view">
                <ApplicantProfilePage />
              </PermissionRoute>
            }
          />
          {/* Older links that carried the id still resolve */}
          <Route path="applications/:id" element={<LegacyApplicantRedirect />} />
          <Route
            path="openings"
            element={
              <PermissionRoute permission="openings.view">
                <OpeningsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="reports"
            element={
              <PermissionRoute permission="reports.view">
                <ReportsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="entities"
            element={
              <PermissionRoute permission="entities.manage">
                <EntitiesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="branches"
            element={
              <PermissionRoute permission="branches.manage">
                <BranchesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="users"
            element={
              <PermissionRoute permission="users.manage">
                <UsersPage />
              </PermissionRoute>
            }
          />
          <Route
            path="roles"
            element={
              <PermissionRoute permission="roles.manage">
                <RolesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="flow"
            element={
              <PermissionRoute permission="flow.manage">
                <FlowConfigPage />
              </PermissionRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
