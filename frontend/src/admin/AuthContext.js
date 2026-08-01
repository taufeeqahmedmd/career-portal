import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  adminLogin,
  adminVerifyTotp,
  changePassword as changePasswordRequest,
  getMe,
  getToken,
  setToken,
  clearToken,
} from "../services/api";
import { clearActiveApplicantId } from "./applicantSession";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restore = async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const res = await getMe();
        setUser(res.data.user);
      } catch (err) {
        // Only a rejected session should sign the user out - a network blip or
        // a server error must not discard a perfectly valid token
        if (err.response?.status === 401) clearToken();
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  // Stores the session and returns the signed-in user
  const acceptSession = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  // Resolves to either { challenge, ... } when two-factor is required, or
  // { user } once the session is open
  const login = useCallback(
    async (email, password, captchaToken) => {
      const res = await adminLogin(email, password, captchaToken);
      if (res.data.challenge) return res.data;
      return { user: acceptSession(res.data) };
    },
    [acceptSession]
  );

  const verifyTotp = useCallback(
    async (challengeToken, code) => {
      const res = await adminVerifyTotp(challengeToken, code);
      return { user: acceptSession(res.data) };
    },
    [acceptSession]
  );

  // The server stamps the change, which invalidates the token this request was
  // made with - so it hands back a fresh one to keep the session alive
  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      const res = await changePasswordRequest(currentPassword, newPassword);
      return acceptSession(res.data);
    },
    [acceptSession]
  );

  const logout = useCallback(() => {
    clearToken();
    clearActiveApplicantId();
    setUser(null);
  }, []);

  const canDo = useCallback(
    (permission) => {
      const perms = user?.permissions || [];
      return perms.includes("*") || perms.includes(permission);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        verifyTotp,
        changePassword,
        logout,
        can: canDo,
        // Accounts still on the initial password may only reach the
        // change-password screen
        mustChangePassword: !!user?.must_change_password,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
