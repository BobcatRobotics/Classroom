CREATE TABLE lesson_completions_v2 (
  id TEXT PRIMARY KEY,
  run_job_id TEXT REFERENCES run_jobs(id),
  student_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  lesson_title TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  build_succeeded INTEGER NOT NULL CHECK (build_succeeded = 1),
  test_passed INTEGER NOT NULL CHECK (test_passed = 1),
  tests_total INTEGER NOT NULL CHECK (tests_total >= 0),
  tests_passed INTEGER NOT NULL CHECK (tests_passed >= 0),
  tests_failed INTEGER NOT NULL CHECK (tests_failed >= 0),
  tests_skipped INTEGER NOT NULL CHECK (tests_skipped >= 0),
  source TEXT NOT NULL DEFAULT 'browser' CHECK (source IN ('browser', 'desktop')),
  source_event_id TEXT
);

INSERT INTO lesson_completions_v2 (
  id, run_job_id, student_id, workspace_id, module_id, lesson_title,
  completed_at, build_succeeded, test_passed, tests_total, tests_passed,
  tests_failed, tests_skipped, source
)
SELECT
  id, run_job_id, student_id, workspace_id, module_id, lesson_title,
  completed_at, build_succeeded, test_passed, tests_total, tests_passed,
  tests_failed, tests_skipped, 'browser'
FROM lesson_completions;

DROP TABLE lesson_completions;
ALTER TABLE lesson_completions_v2 RENAME TO lesson_completions;

CREATE INDEX idx_lesson_completions_student
  ON lesson_completions (student_id, completed_at DESC);
CREATE INDEX idx_lesson_completions_workspace
  ON lesson_completions (workspace_id, completed_at DESC);
CREATE INDEX idx_lesson_completions_module
  ON lesson_completions (module_id, completed_at DESC);
CREATE UNIQUE INDEX idx_lesson_completions_desktop_event
  ON lesson_completions (student_id, source_event_id)
  WHERE source = 'desktop' AND source_event_id IS NOT NULL;

CREATE TABLE lesson_completion_sync_outbox (
  completion_id TEXT PRIMARY KEY REFERENCES lesson_completions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);