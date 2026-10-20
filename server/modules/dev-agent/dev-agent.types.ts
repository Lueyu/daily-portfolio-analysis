/**
 * @file dev-agent.types.ts
 * @description Shared types and HTTP DTOs for the local Coding-Agent console.
 *
 * These types mirror the Python work products under
 * `agent/data/coder/tasks/<id>/` (task.json, iterations.jsonl, patches/*.diff).
 * The Python files are the single source of truth; the backend only renders
 * them and forwards commands, so these interfaces must stay field-compatible
 * with the pydantic models in `agent/src/agent_core/coder/models.py`.
 */
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** The eight task states from the Python state machine. */
export type DevTaskStatus =
  | 'new'
  | 'reproduced'
  | 'diagnosed'
  | 'patched'
  | 'verifying'
  | 'awaiting_approval'
  | 'verified'
  | 'blocked';

/** The four whitelisted verification checks. */
export const CHECK_KIND = {
  Unit: 'unit',
  E2E: 'e2e',
  Typecheck: 'typecheck',
  Lint: 'lint',
} as const;
export type CheckKind = (typeof CHECK_KIND)[keyof typeof CHECK_KIND];
export const CHECK_KINDS: CheckKind[] = Object.values(CHECK_KIND);

/** Terminal states stop the frontend polling. */
export const TERMINAL_STATUSES: ReadonlySet<DevTaskStatus> = new Set<DevTaskStatus>([
  'verified',
  'blocked',
]);

export interface AcceptanceCriterion {
  id: string;
  description: string;
  check: CheckKind;
  target?: string | null;
}

export interface DevTask {
  id: string;
  title: string;
  problem: string;
  acceptance: AcceptanceCriterion[];
  workdir: string;
  branch: string;
  status: DevTaskStatus;
  red_seen: boolean;
  diagnosis_rethink_count: number;
  created_at: string;
  updated_at: string;
}

export interface Iteration {
  index: number;
  phase: string;
  hypothesis: string;
  action: string;
  model_calls: number;
  observations: string[];
  decision: string;
  created_at: string;
}

/** Metadata about a proposed patch (the diff text is fetched separately). */
export interface PatchMeta {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  createdAt: string | null;
}

/** Detail payload for a single task. */
export interface DevTaskDetail extends DevTask {
  iterations: Iteration[];
  latestPatch: PatchMeta | null;
  patchCount: number;
}

/** Compact row for the task list. */
export interface DevTaskSummary {
  id: string;
  title: string;
  status: DevTaskStatus;
  redSeen: boolean;
  iterationCount: number;
  updatedAt: string;
}

export interface PatchDetail {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  diff: string;
}

export interface ProcessResult {
  returnCode: number;
  stdout: string;
  stderr: string;
}

export interface DevAgentHealth {
  enabled: boolean;
  binExists: boolean;
  tasksDirExists: boolean;
  binPath: string;
  tasksDir: string;
}

export interface CommandJson {
  ok: boolean;
  id?: string;
  status?: DevTaskStatus;
}

/** One acceptance criterion in the create-task request. */
export class AcceptanceInputDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsEnum(CHECK_KIND)
  check!: CheckKind;

  @IsOptional()
  @IsString()
  target?: string | null;
}

/** POST /api/dev/tasks body. */
export class CreateDevTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  problem!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AcceptanceInputDto)
  acceptance!: AcceptanceInputDto[];

  @IsOptional()
  @IsString()
  workdir?: string | null;
}

/** POST /api/dev/tasks/:id/reject body. */
export class RejectDevTaskDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

export interface CreateDevTaskInput {
  title: string;
  problem: string;
  acceptance: {
    id: string;
    kind: CheckKind;
    description: string;
    target?: string | null;
  }[];
  workdir?: string | null;
}
