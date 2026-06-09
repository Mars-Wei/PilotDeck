import type { Project } from '../types/app';

export type AlwaysOnPresencePayload = {
  selectedProject: Project | null;
  alwaysOnProjects: Project[];
  processingSessionIds: string[];
  lastUserMsgAt: string | null;
};

export function sendAlwaysOnPresence(
  sendMessage: (message: unknown) => boolean,
  payload: AlwaysOnPresencePayload,
): void {
  sendMessage({
    type: 'always-on-presence',
    ...payload,
  });
}

export function clearAlwaysOnPresence(sendMessage: (message: unknown) => boolean): void {
  sendMessage({ type: 'always-on-presence-clear' });
}
