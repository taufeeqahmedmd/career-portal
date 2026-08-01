import axios from 'axios';

const TOKEN_KEY = 'admin_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.endsWith('/admin/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      clearToken();
      if (window.location.pathname.startsWith('/admin')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(error);
  }
);

// Public
export const getOpenings = () => api.get('/openings');
export const getPublicBranches = () => api.get('/branches');
export const getPublicEntities = () => api.get('/entities');
export const submitApplication = (data) => api.post('/applications', data);
// Tells the forms whether the Cloudflare Turnstile widget has to be rendered
export const getPublicConfig = () => api.get('/config');

// Admin auth
export const adminLogin = (email, password, captchaToken) =>
  api.post('/admin/login', { email, password, captcha_token: captchaToken });
// Second leg of a two-factor sign-in
export const adminVerifyTotp = (challengeToken, code) =>
  api.post('/admin/login/totp', { challenge_token: challengeToken, code });
export const forgotPassword = (email, captchaToken) =>
  api.post('/admin/forgot-password', { email, captcha_token: captchaToken });
export const resetPassword = (email, code, newPassword) =>
  api.post('/admin/reset-password', { email, code, new_password: newPassword });
export const changePassword = (currentPassword, newPassword) =>
  api.post('/admin/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
export const getMe = () => api.get('/admin/me');

// Security settings (super admin)
export const getSecuritySettings = () => api.get('/admin/security');
export const updateSecuritySettings = (data) => api.put('/admin/security', data);
export const setUserTotp = (id, enabled) => api.patch(`/admin/users/${id}/totp`, { enabled });

// Admin entities
export const getEntities = () => api.get('/admin/entities');
export const createEntity = (data) => api.post('/admin/entities', data);
export const updateEntity = (id, data) => api.put(`/admin/entities/${id}`, data);
export const deleteEntity = (id) => api.delete(`/admin/entities/${id}`);

// Admin branches
export const getBranches = () => api.get('/admin/branches');
export const createBranch = (data) => api.post('/admin/branches', data);
export const updateBranch = (id, data) => api.put(`/admin/branches/${id}`, data);
export const deleteBranch = (id) => api.delete(`/admin/branches/${id}`);

// Admin openings
export const getAdminOpenings = () => api.get('/admin/openings');
export const createOpening = (data) => api.post('/admin/openings', data);
export const updateOpening = (id, data) => api.put(`/admin/openings/${id}`, data);

// Admin applications
export const getApplications = (params) => api.get('/admin/applications', { params });
export const getApplication = (id) => api.get(`/admin/applications/${id}`);
// Resumes are private: streamed from the portal, never a public Drive link
export const getApplicationResume = (id) =>
  api.get(`/admin/applications/${id}/resume`, { responseType: 'blob' });
export const getApplicationStats = () => api.get('/admin/applications/stats');
// Hiring flow configuration
export const getFlowOptions = () => api.get('/admin/flow-options');
export const getActiveFlowOptions = () => api.get('/admin/flow-options/active');
export const createFlowOption = (data) => api.post('/admin/flow-options', data);
export const updateFlowOption = (id, data) => api.put(`/admin/flow-options/${id}`, data);
export const deleteFlowOption = (id) => api.delete(`/admin/flow-options/${id}`);
export const updateScreening = (id, data) => api.put(`/admin/applications/${id}/screening`, data);
export const updateInterviewRound = (id, roundNo, data) =>
  api.put(`/admin/applications/${id}/rounds/${roundNo}`, data);
export const updateSuggestedRole = (id, data) =>
  api.put(`/admin/applications/${id}/suggestion`, data);
export const requestExportOtp = (params) =>
  api.post('/admin/applications/export/request-otp', null, { params });
export const exportApplicationsCsv = (params) =>
  api.get('/admin/applications/export', { params, responseType: 'blob' });

// Admin users
// CSV bulk imports
const uploadCsv = (url, file) => {
  const data = new FormData();
  data.append('file', file);
  return api.post(url, data);
};
export const importUsersCsv = (file) => uploadCsv('/admin/users/import', file);
export const importOpeningsCsv = (file) => uploadCsv('/admin/openings/import', file);
export const importFlowOptionsCsv = (file) => uploadCsv('/admin/flow-options/import', file);

export const getUsers = () => api.get('/admin/users');
export const createUser = (data) => api.post('/admin/users', data);
export const setUserActive = (id, isActive) =>
  api.patch(`/admin/users/${id}`, { is_active: isActive });
export const updateUser = (id, data) => api.put(`/admin/users/${id}`, data);

// Admin roles
export const getRoles = () => api.get('/admin/roles');
export const getPermissionCatalog = () => api.get('/admin/roles/catalog');
export const createRole = (data) => api.post('/admin/roles', data);
export const updateRole = (id, data) => api.put(`/admin/roles/${id}`, data);
export const deleteRole = (id) => api.delete(`/admin/roles/${id}`);

export default api;
