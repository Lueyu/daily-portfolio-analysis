-- Durable research-room turns, existing conversations remain readable.
ALTER TABLE council_sessions ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS checkpoint jsonb;
ALTER TABLE council_messages ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE council_reports ADD COLUMN IF NOT EXISTS research_stance varchar(10)
  CHECK (research_stance IS NULL OR research_stance IN ('positive', 'balanced', 'cautious'));
