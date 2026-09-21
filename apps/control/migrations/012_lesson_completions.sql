ALTER TABLE run_jobs ADD COLUMN build_succeeded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_jobs ADD COLUMN module_id TEXT;
ALTER TABLE run_jobs ADD COLUMN tests_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_jobs ADD COLUMN tests_passed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_jobs ADD COLUMN tests_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_jobs ADD COLUMN tests_skipped INTEGER NOT NULL DEFAULT 0;

CREATE TABLE lesson_completions (
  id TEXT PRIMARY KEY,
  run_job_id TEXT NOT NULL UNIQUE REFERENCES run_jobs(id),
  student_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  lesson_title TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  build_succeeded INTEGER NOT NULL CHECK (build_succeeded = 1),
  test_passed INTEGER NOT NULL CHECK (test_passed = 1),
  tests_total INTEGER NOT NULL CHECK (tests_total >= 0),
  tests_passed INTEGER NOT NULL CHECK (tests_passed >= 0),
  tests_failed INTEGER NOT NULL CHECK (tests_failed >= 0),
  tests_skipped INTEGER NOT NULL CHECK (tests_skipped >= 0)
);

CREATE INDEX idx_lesson_completions_student
  ON lesson_completions (student_id, completed_at DESC);
CREATE INDEX idx_lesson_completions_workspace
  ON lesson_completions (workspace_id, completed_at DESC);
CREATE INDEX idx_lesson_completions_module
  ON lesson_completions (module_id, completed_at DESC);