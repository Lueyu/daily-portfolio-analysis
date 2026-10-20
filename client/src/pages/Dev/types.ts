/**
 * @file types.ts
 * @description Browser-side types for the local Coding-Agent console.
 *
 * These mirror the JSON returned by the Nest `/api/dev` module. The Python
 * artifacts use snake_case for the core task fields; the derived summary and
 * patch metadata emitted by the backend are camelCase. Keep the two shapes in
 * sync with `server/modules/dev-agent/dev-agent.types.ts`.
 */

export type DevStatus =
  | 'new'
  | 'reproduced'
  | 'diagnosed'
  | 'patched'
  | 'verifying'
  | 'awaiting_approval'
  | 'verified'
  | 'blocked';

export type CheckKind = 'unit' | 'e2e' | 'typecheck' | 'lint';

export interface DevAcceptance {
  id: string;
  description: string;
  check: CheckKind;
  /** Optional target for the check: a test file or URL to verify. */
  target?: string | null;
}

export interface DevIteration {
  index: number;
  phase: string;
  hypothesis: string;
  action: string;
  model_calls: number;
  observations: string[];
  decision: string;
  created_at: string;
}

export interface DevPatchMeta {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  createdAt: string | null;
}

export interface DevTaskDetail {
  id: string;
  title: string;
  problem: string;
  acceptance: DevAcceptance[];
  workdir: string;
  branch: string;
  status: DevStatus;
  red_seen: boolean;
  diagnosis_rethink_count: number;
  created_at: string;
  updated_at: string;
  iterations: DevIteration[];
  latestPatch: DevPatchMeta | null;
  patchCount: number;
}

export interface DevTaskSummary {
  id: string;
  title: string;
  status: DevStatus;
  redSeen: boolean;
  iterationCount: number;
  updatedAt: string;
}

export interface DevPatchDetail {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  diff: string;
}

export interface DevHealth {
  enabled: boolean;
  binExists: boolean;
  tasksDirExists: boolean;
  binPath: string;
  tasksDir: string;
}

export interface CreateDevTaskPayload {
  title: string;
  problem: string;
  acceptance: {
    id: string;
    check: CheckKind;
    description: string;
    target?: string | null;
  }[];
  workdir?: string | null;
}

/** Terminal statuses: once reached the loop stops and no run is accepted. */
export const TERMINAL_STATUSES: DevStatus[] = ['verified', 'blocked'];

/** Status that pauses the loop for a human to review the patch. */
export const AWAITING_STATUS: DevStatus = 'awaiting_approval';

/** Ordered list of the eight task states, used to draw the step indicator. */
export const STATUS_ORDER: DevStatus[] = [
  'new',
  'reproduced',
  'diagnosed',
  'patched',
  'verifying',
  'awaiting_approval',
  'verified',
  'blocked',
];
