const BASE = '/api';
const getToken  = () => localStorage.getItem('cos_token');
export const setToken   = t => localStorage.setItem('cos_token', t);
export const clearToken = () => localStorage.removeItem('cos_token');
export const isLoggedIn = () => Boolean(getToken());

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { clearToken(); window.location.href = '/login'; return; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login:      (email, password) => req('POST', '/auth/login', { email, password }),
  dashboard:  ()                => req('GET',  '/pm/dashboard'),
  projects:   ()                => req('GET',  '/pm/projects'),
  getProject: (id)              => req('GET',  `/pm/projects/${id}`),
  createProject: (d)            => req('POST', '/pm/projects', d),
  updateProject: (id, d)        => req('PATCH', `/pm/projects/${id}`, d),
  gantt:      (id)              => req('GET',  `/pm/projects/${id}/gantt`),
  createTask: (d)               => req('POST', '/pm/tasks', d),
  updateTask: (id, d)           => req('PATCH', `/pm/tasks/${id}`, d),
  deleteTask: (id)              => req('DELETE', `/pm/tasks/${id}`),
  risks:      (projectId)       => req('GET',  `/pm/risks?projectId=${projectId || ''}`),
  createRisk: (d)               => req('POST', '/pm/risks', d),
};
