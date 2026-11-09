// Client for Settings → Background Jobs — backend `forge/api/background_jobs.py`.
//
// Which local model names chats and which folds old turns into the rolling
// summary, and how the title job behaves. See `forge/background_models.py`.

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

export type JobName = 'title' | 'summary' | 'persona';

/** One run of a background job (`chat/job_runs.py`). In memory since the backend started. */
export interface JobRun {
  job: JobName;
  /** Null for an incognito chat: Settings never links to one. */
  session_id: string | null;
  status: 'running' | 'done' | 'skipped' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  model: string | null;
  /** What it did, why it skipped, or the error. */
  detail: string | null;
  /** Null when the chat has since been deleted. */
  chat: { incognito: boolean; title: string | null } | null;
}

export interface JobRuns {
  runs: Record<JobName, JobRun[]>;
  persona_enabled: boolean;
  keep: number;
}

export const fetchJobRuns = () => request<JobRuns>('/api/background-jobs/runs');
