'use strict';

const BASE = (import.meta.env.VITE_API_URL || '') + '/api';

function getToken() {
  return localStorage.getItem('cos_token');
}

export function setToken(t) {
  localStorage.setItem('cos_token', t);
}

export function clearToken() {
  localStorage.removeItem('cos_token');
}

export function isLoggedIn() {
  return Boolean(getToken());
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  get:    (path)       => request('GET',    path),
  post:   (path, body) => request('POST',   path, body),
  patch:  (path, body) => request('PATCH',  path, body),
  delete: (path)       => request('DELETE', path),

  // Auth
  login: (email, password) => request('POST', '/auth/login', { email, password }),

  // BOQ
  listBOQs:       (projectId) => request('GET', `/qs/boq?projectId=${projectId || ''}`),
  getBOQ:         (id)        => request('GET', `/qs/boq/${id}`),
  createBOQ:      (data)      => request('POST', '/qs/boq', data),
  updateBOQItem:  (boqId, itemId, data) => request('PATCH', `/qs/boq/${boqId}/items/${itemId}`, data),
  approveBOQ:     (id)        => request('POST', `/qs/boq/${id}/approve`),
  exportBOQ:      (id)        => fetch(`${BASE}/qs/boq/${id}/export`, { headers: { Authorization: `Bearer ${getToken()}` } }),

  // Takeoff
  listDocuments:  ()          => request('GET', '/qs/takeoff/documents'),
  getDocument:    (id)        => request('GET', `/qs/takeoff/documents/${id}`),
  createDocument: (data)      => request('POST', '/qs/takeoff/documents', data),
  getMeasurements:(docId)     => request('GET', `/qs/takeoff/documents/${docId}/measurements`),
  saveMeasurement:(docId, d)  => request('POST', `/qs/takeoff/documents/${docId}/measurements`, d),
  deleteMeasurement:(docId, mId) => request('DELETE', `/qs/takeoff/documents/${docId}/measurements/${mId}`),
  calibrate:      (docId, d)  => request('POST', `/qs/takeoff/documents/${docId}/calibrate`, d),
  estimate:       (data)      => request('POST', '/qs/boq/estimate', data),
};
