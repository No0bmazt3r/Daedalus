// Client for Settings → Background Jobs — backend `api/background_jobs.py`.
//
// Which local model names chats and which folds old turns into the rolling
// summary, and how the title job behaves. See `services/background_models.py`.

import { request } from './http';

export type TitleMode = 'model' | 'first_message';

export interface BackgroundJobsConfig {
  title: { mode: TitleMode; model: string; refresh_every: number };
  summary: { model: string };
}

export interface ResolvedJob {
  tag: string | null;
  source: 'auto' | 'configured' | 'fallback';
  reason: string;
}

export interface BackgroundJobsStatus {
  config: BackgroundJobsConfig;
  /** Local, installed, able to complete a prompt — the only models a job may use. */
  models: { name: string; size?: number; parameter_size?: string }[];
  resolved: { title: ResolvedJob; summary: ResolvedJob };
  path: string;
}

export type BackgroundJobsPatch = {
  title?: Partial<BackgroundJobsConfig['title']>;
  summary?: Partial<BackgroundJobsConfig['summary']>;
};

export const fetchBackgroundJobs = () => request<BackgroundJobsStatus>('/api/background-jobs');

export const saveBackgroundJobs = (patch: BackgroundJobsPatch) =>
  request<BackgroundJobsStatus>('/api/background-jobs', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
