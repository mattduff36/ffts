-- Messages and Notifications System
-- Creates tables for Toolbox Talk messages and Reminders with notification inbox

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('TOOLBOX_TALK', 'REMINDER', 'NOTIFICATION')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('LOW', 'HIGH', 'URGENT')),
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_via TEXT DEFAULT 'web',
  module_key TEXT NOT NULL DEFAULT 'general_notifications' CHECK (
    module_key IN (
      'errors',
      'maintenance',
      'rams',
      'approvals',
      'inspections',
      'absence',
      'timesheets',
      'inventory',
      'processed_absence',
      'training',
      'suggestions',
      'toolbox_talks',
      'reminders',
      'quotes',
      'general_notifications',
      'sensitive_pin_security'
    )
  ),
  acceptance_delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (acceptance_delay_minutes >= 0 AND acceptance_delay_minutes <= 1440)
);

-- Message Recipients Table (one row per user per message)
CREATE TABLE IF NOT EXISTS message_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SHOWN', 'SIGNED', 'DISMISSED')),
  signed_at TIMESTAMPTZ,
  first_shown_at TIMESTAMPTZ,
  cleared_from_inbox_at TIMESTAMPTZ,
  signature_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_messages_module_key_created_at ON messages(module_key, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at);

CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON message_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_status ON message_recipients(status);
CREATE INDEX IF NOT EXISTS idx_message_recipients_created_at ON message_recipients(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_recipients_cleared ON message_recipients(cleared_from_inbox_at);

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies for messages

-- Managers/admins can view all messages they created
DROP POLICY IF EXISTS "Managers can view their messages" ON messages;
CREATE POLICY "Managers can view their messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Employees can view messages assigned to them (via message_recipients join)
DROP POLICY IF EXISTS "Users can view assigned messages" ON messages;
CREATE POLICY "Users can view assigned messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM message_recipients 
      WHERE message_id = messages.id 
      AND user_id = auth.uid()
    )
  );

-- Managers/admins can create messages
DROP POLICY IF EXISTS "Managers can create messages" ON messages;
CREATE POLICY "Managers can create messages" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Managers/admins can update messages (for soft delete)
DROP POLICY IF EXISTS "Managers can update messages" ON messages;
CREATE POLICY "Managers can update messages" ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- RLS Policies for message_recipients

-- Users can view their own message recipient records
DROP POLICY IF EXISTS "Users can view their recipients" ON message_recipients;
CREATE POLICY "Users can view their recipients" ON message_recipients
  FOR SELECT USING (user_id = auth.uid());

-- Managers/admins can view all message recipient records
DROP POLICY IF EXISTS "Managers can view all recipients" ON message_recipients;
CREATE POLICY "Managers can view all recipients" ON message_recipients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Managers/admins can create message recipient records
DROP POLICY IF EXISTS "Managers can create recipients" ON message_recipients;
CREATE POLICY "Managers can create recipients" ON message_recipients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Users can update their own recipient records (for signing/dismissing)
DROP POLICY IF EXISTS "Users can update their recipients" ON message_recipients;
CREATE POLICY "Users can update their recipients" ON message_recipients
  FOR UPDATE USING (user_id = auth.uid());

-- Managers/admins can update any recipient record
DROP POLICY IF EXISTS "Managers can update recipients" ON message_recipients;
CREATE POLICY "Managers can update recipients" ON message_recipients
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Updated timestamp trigger for messages
CREATE OR REPLACE FUNCTION update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_updated_at ON messages;
CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_updated_at();

-- Updated timestamp trigger for message_recipients
CREATE OR REPLACE FUNCTION update_message_recipients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_recipients_updated_at ON message_recipients;
CREATE TRIGGER message_recipients_updated_at
  BEFORE UPDATE ON message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION update_message_recipients_updated_at();

