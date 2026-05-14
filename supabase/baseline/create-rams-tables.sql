-- RAMS Documents Table
CREATE TABLE IF NOT EXISTS rams_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,  -- Supabase Storage path
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,  -- 'pdf' or 'docx'
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1
);

-- RAMS Assignments Table (Employee assignments)
CREATE TABLE IF NOT EXISTS rams_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rams_document_id UUID REFERENCES rams_documents(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending',  -- 'pending', 'read', 'signed'
  read_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signature_data TEXT,  -- Base64 signature image
  UNIQUE(rams_document_id, employee_id)
);

-- RAMS Visitor Signatures Table
CREATE TABLE IF NOT EXISTS rams_visitor_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rams_document_id UUID REFERENCES rams_documents(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_company TEXT,
  visitor_role TEXT,
  signature_data TEXT NOT NULL,  -- Base64 signature image
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- Employee who facilitated
  CONSTRAINT unique_visitor_signature UNIQUE(rams_document_id, visitor_name, visitor_company)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rams_documents_uploaded_by ON rams_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_rams_documents_created_at ON rams_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rams_documents_is_active ON rams_documents(is_active);

CREATE INDEX IF NOT EXISTS idx_rams_assignments_document_id ON rams_assignments(rams_document_id);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_employee_id ON rams_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_status ON rams_assignments(status);

CREATE INDEX IF NOT EXISTS idx_rams_visitor_signatures_document_id ON rams_visitor_signatures(rams_document_id);
CREATE INDEX IF NOT EXISTS idx_rams_visitor_signatures_signed_at ON rams_visitor_signatures(signed_at DESC);

-- Enable RLS
ALTER TABLE rams_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rams_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rams_visitor_signatures ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rams_documents

-- Admins and managers can view all RAMS documents
CREATE POLICY "Managers can view all RAMS documents" ON rams_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Employees can only view documents assigned to them
CREATE POLICY "Employees can view assigned RAMS" ON rams_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rams_assignments 
      WHERE rams_document_id = rams_documents.id 
      AND employee_id = auth.uid()
    )
  );

-- Managers can insert RAMS documents
CREATE POLICY "Managers can create RAMS documents" ON rams_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Managers can update their own RAMS documents
CREATE POLICY "Managers can update RAMS documents" ON rams_documents
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Managers can delete RAMS documents
CREATE POLICY "Managers can delete RAMS documents" ON rams_documents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- RLS Policies for rams_assignments

-- Users can view their own assignments
CREATE POLICY "Users can view their assignments" ON rams_assignments
  FOR SELECT USING (employee_id = auth.uid());

-- Managers can view all assignments
CREATE POLICY "Managers can view all assignments" ON rams_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Managers can create assignments
CREATE POLICY "Managers can create assignments" ON rams_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Employees can update their own assignments (for signing)
CREATE POLICY "Employees can sign their assignments" ON rams_assignments
  FOR UPDATE USING (employee_id = auth.uid());

-- Managers can update any assignment
CREATE POLICY "Managers can update assignments" ON rams_assignments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- RLS Policies for rams_visitor_signatures

-- Managers can view all visitor signatures
CREATE POLICY "Managers can view visitor signatures" ON rams_visitor_signatures
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Employees can view visitor signatures they recorded
CREATE POLICY "Employees can view their recorded signatures" ON rams_visitor_signatures
  FOR SELECT USING (recorded_by = auth.uid());

-- Any authenticated user can insert visitor signatures (if they've signed the document)
CREATE POLICY "Users can record visitor signatures" ON rams_visitor_signatures
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM rams_assignments 
      WHERE rams_document_id = rams_visitor_signatures.rams_document_id 
      AND employee_id = auth.uid()
      AND status = 'signed'
    )
  );

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_rams_document_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rams_documents_updated_at
  BEFORE UPDATE ON rams_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_rams_document_updated_at();

