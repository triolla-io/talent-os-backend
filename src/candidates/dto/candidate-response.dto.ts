/**
 * DTO for GET /api/candidates response
 * Includes hiring stage information for Kanban board rendering
 */
export interface CandidateResponse {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  location: string | null;
  cv_file_url: string | null;
  source: string;
  created_at: Date;
  ai_score: number | null;
  is_duplicate: boolean;
  skills: string[];

  // NEW: Kanban board stage tracking
  job_id: string | null;
  hiring_stage_id: string | null;
  hiring_stage_name: string | null;
}
