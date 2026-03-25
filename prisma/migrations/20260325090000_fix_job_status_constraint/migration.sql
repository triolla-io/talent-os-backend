-- Fix job status constraint to match API spec
-- DB constraint was created with 4 values: ['active', 'draft', 'closed', 'paused']
-- But API spec (API_PROTOCOL_MVP.md) defines only 3 values: ['draft', 'open', 'closed']
-- Root cause: Initial migration defined wrong constraint; API code and tests correctly use 'open'

-- Migrate existing 'active' status rows to 'open' to match API spec
UPDATE jobs SET status = 'open' WHERE status = 'active';

-- Drop the incorrect constraint
ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;

-- Create corrected constraint matching API spec
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('draft', 'open', 'closed'));
