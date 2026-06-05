import type { Project, ProjectSession } from '../../../types/app';
import { projectDisplayName, sessionDisplayTitle } from '../../../lib/customNames';

export function formatCost(value: number | undefined | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function projectName(project: Project): string {
  return projectDisplayName(project);
}

export function sessionTitle(session: ProjectSession): string {
  return sessionDisplayTitle(session);
}

export function getSessionTimestamp(session: ProjectSession): number {
  const candidates = [
    session.lastActivity,
    session.updated_at,
    session.createdAt,
    session.created_at,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function formatShortDate(timestamp: number): string {
  if (!timestamp) return '暂无';
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}
