import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

const ProtectedRoute = ({ children }) => {
  const { user, loading, mustChangePassword } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-stone-500">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  // An account still on the password it was issued gets one destination only.
  // The server enforces the same rule, so this is convenience, not the guard.
  if (mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }

  return children;
};

export const PermissionRoute = ({ permission, children }) => {
  const { can } = useAuth();
  if (!can(permission)) {
    return <Navigate to="/admin" replace />;
  }
  return children;
};

export default ProtectedRoute;
