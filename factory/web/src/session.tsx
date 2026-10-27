import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import type { Me, Role, Workspace } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), staleTime: 60_000 });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['me'] });
}

export type Action = 'read' | 'edit' | 'approve' | 'publish' | 'admin';
const MATRIX: Record<Role, Action[]> = {
  owner: ['read', 'edit', 'approve', 'publish', 'admin'],
  admin: ['read', 'edit', 'approve', 'publish', 'admin'],
  editor: ['read', 'edit', 'publish'],
  approver: ['read', 'approve'],
  viewer: ['read'],
};

export interface WsCtx {
  ws: Workspace;
  base: string;
  can: (a: Action) => boolean;
}

const Ctx = createContext<WsCtx | null>(null);

export function WsProvider({ ws, children }: { ws: Workspace; children: ReactNode }) {
  const value: WsCtx = { ws, base: `/w/${ws.id}`, can: (a) => !ws.isDemo && MATRIX[ws.role].includes(a) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWs(): WsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWs outside workspace');
  return v;
}

/** Workspace-scoped API path. */
export function useWsApi() {
  const { ws } = useWs();
  return (p: string) => `/api/ws/${ws.id}${p}`;
}
