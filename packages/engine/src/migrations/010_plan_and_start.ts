// LDJ-23/24 review. Two plain columns, neither personal (PLAN.md §8.1: only a lesson's answers are):
// - course_progress.started_at: when a lesson became the current one. The move-on rules count from it; updated_at
//   moved with every later write, which restarted the lesson's clock. Rows made before this get their creation time
//   (when the lesson was first touched); the handler never moves a start once it is set.
// - nights.no_recall: "No recall" said in so many words. Train's "Use tonight" makes a night that holds only a plan;
//   that is not a logged morning, so streaks, rates and the Journal leave it out until something is written, and a
//   night without dreams needs this mark to count as "nothing recalled". Nights made before this without dreams or a
//   plan were exactly those marks.
export default /* sql */ `
ALTER TABLE course_progress ADD COLUMN IF NOT EXISTS started_at timestamptz;
UPDATE course_progress SET started_at = created_at WHERE started_at IS NULL AND state IN ('active', 'done');
ALTER TABLE nights ADD COLUMN IF NOT EXISTS no_recall boolean NOT NULL DEFAULT false;
UPDATE nights n SET no_recall = true
  WHERE n.techniques_planned = '{}' AND NOT EXISTS (SELECT 1 FROM dreams d WHERE d.night_id = n.id AND d.deleted_at IS NULL);
`;
