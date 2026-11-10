export type Role = 'student' | 'teacher' | 'admin';
export type StepId = 'diag' | 'video' | 'pres' | 'doc' | 'task' | 'refl';

export interface User {
  id: number;
  name: string | null;
  login: string;
  role: Role;
}

export interface Module {
  id: number;
  order_num: number;
  title: string;
  description: string | null;
  created_by: number | null;
  deleted_at?: string | null;
}

export interface StoredFile {
  id: string;
  name: string;
  size: number;
}

export interface QuizQuestion {
  text: string;
  options: string[];
  correct: number | null;
  ai_marked?: boolean;
}

export interface StepContent {
  value?: string;
  answer?: string;
  file?: StoredFile | null;
  questions?: QuizQuestion[];
  questions_count?: number;
}

export interface ContentRow {
  module_id: number;
  step_type: StepId;
  content: StepContent | null;
}

export interface Review {
  feedback: string;
  teacher_name?: string;
  reviewed_at?: string;
}

export interface QuizDetail {
  question: string;
  chosen: string;
  right?: string;
  correct: boolean;
}

export interface StepResponses {
  [key: string]: unknown;
  diag?: string;
  diag_correct?: boolean;
  diag_result?: { correct: number; total: number; score: number };
  diag_detail?: QuizDetail[];
  task?: string;
  refl?: string;
  task_file?: StoredFile;
  reviews?: Partial<Record<StepId, Review>>;
}

export interface Progress {
  id: number;
  user_id: number;
  module_id: number;
  completed_steps: StepId[];
  step_responses: StepResponses;
  total_score: number;
  updated_at?: string;
  student_name?: string;
  student_login?: string;
  module_title?: string;
  module_order?: number;
}

export interface StudentPaper {
  version: string;
  questions: { text: string; options: string[] }[];
}

export interface UserRow {
  id: number;
  name: string | null;
  login: string;
  role: Role;
  status: string | null;
  created_at: string | null;
  last_login_at: string | null;
  modules_started: number;
  modules_finished: number;
  total_score: number;
  modules_created: number;
}

export interface UsersPage {
  items: UserRow[];
  total: number;
  page: number;
  page_size: number;
  counts: { student?: number; teacher?: number; pending?: number };
}

export interface UserProfile {
  id: number;
  name: string | null;
  login: string;
  role: Role;
  status: string | null;
  created_at: string | null;
  last_login_at: string | null;
  modules_created: { id: number; order_num: number; title: string }[];
}

export interface ErrorLogEntry {
  id: number;
  created_at: string;
  source: 'server' | 'client';
  message: string;
  detail: string | null;
  path: string | null;
  user_agent: string | null;
  user_name: string | null;
}
