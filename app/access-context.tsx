"use client";

import { createContext, useContext } from 'react';

export type AccessViewer = { id: string; memberId: string | null; name: string; role: 'admin' | 'member'; loginId: string };
export type AccessState = { authenticated: boolean; needsSetup: boolean; setupAllowed: boolean; viewer?: AccessViewer };
export const AccessContext = createContext<{ viewer: AccessViewer; refresh: () => Promise<void>; logout: () => Promise<void>; recordRecovery: (result: { viewer: AccessViewer; recoveryCode: string }) => void } | null>(null);
export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) throw new Error('入場情報を読み込めませんでした。');
  return context;
}
export async function accessRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({ error: '通信を確認して、もう一度お試しください。' }));
  if (response.status === 401 && !body && (path === '/api/access/admin' || path === '/api/team')) window.dispatchEvent(new Event('access-expired'));
  if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : '処理できませんでした。もう一度お試しください。');
  return result as T;
}
