-- Create actions table for manager defect/todo tracking

CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  inspection_item_id UUID REFERENCES inspection_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  actioned BOOLEAN NOT NULL DEFAULT FALSE,
  actioned_at TIMESTAMP WITH TIME ZONE,
  actioned_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

-- Managers can see all actions
CREATE POLICY "Managers can view all actions"
  ON actions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Managers can create actions
CREATE POLICY "Managers can create actions"
  ON actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Managers can update actions
CREATE POLICY "Managers can update actions"
  ON actions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Managers can delete actions
CREATE POLICY "Managers can delete actions"
  ON actions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_actions_inspection_id ON actions(inspection_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_actioned ON actions(actioned);
CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at DESC);

-- Add comments
COMMENT ON TABLE actions IS 'Manager actions and defects tracking from vehicle inspections';
COMMENT ON COLUMN actions.inspection_id IS 'Reference to the inspection that generated this action (nullable for manual actions)';
COMMENT ON COLUMN actions.inspection_item_id IS 'Reference to the specific inspection item that failed';
COMMENT ON COLUMN actions.title IS 'Short title/description of the action';
COMMENT ON COLUMN actions.description IS 'Detailed description of the issue and required action';
COMMENT ON COLUMN actions.priority IS 'Priority level: low, medium, high, urgent';
COMMENT ON COLUMN actions.status IS 'Current status: pending, in_progress, completed';
COMMENT ON COLUMN actions.actioned IS 'Whether the action has been marked as actioned/resolved';
COMMENT ON COLUMN actions.actioned_at IS 'Timestamp when the action was marked as actioned';
COMMENT ON COLUMN actions.actioned_by IS 'User who marked the action as actioned';

