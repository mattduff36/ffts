# RAMS Feature - Product Requirements Document

**Feature Name**: Risk Assessment & Method Statement (RAMS) Management  
**Created**: October 30, 2025  
**Status**: 📋 Planning Phase  
**Priority**: High  
**Branch**: `feature/rams-documents`

---

## 📋 Executive Summary

The RAMS feature allows managers and admins to upload health & safety documents (Risk Assessments & Method Statements), distribute them to specific employees for review, track who has read and signed them, and generate compliance reports with signatures.

**Key Benefits**:
- ✅ Digital distribution of safety documents
- ✅ Proof of employee acknowledgment
- ✅ Audit trail for compliance
- ✅ Visitor/contractor sign-off capability
- ✅ Centralized document management

---

## 🎯 User Stories

### Manager/Admin Stories

**US-1**: As a manager, I want to upload RAMS documents so employees can review and acknowledge them digitally.

**US-2**: As a manager, I want to select specific employees to send a RAMS document to, so only relevant personnel receive it.

**US-3**: As a manager, I want to see who has signed a RAMS document and who hasn't, so I can track compliance.

**US-4**: As a manager, I want to export a RAMS document with all signatures, so I can provide proof of compliance to clients or inspectors.

### Employee Stories

**US-5**: As an employee, I want to see a badge notification when I have new RAMS documents to review, so I don't miss important safety information.

**US-6**: As an employee, I want to read RAMS documents within the app, so I can review them on mobile or desktop.

**US-7**: As an employee, I want to digitally sign RAMS documents after reading them, so I can acknowledge that I've understood the safety requirements.

**US-8**: As an employee, I want to allow visitors/contractors to sign RAMS documents through my account, so they can acknowledge safety requirements even without app access.

---

## 🏗️ System Architecture

### Database Schema

#### `rams_documents` Table
```sql
CREATE TABLE rams_documents (
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
```

#### `rams_assignments` Table
```sql
CREATE TABLE rams_assignments (
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
```

#### `rams_visitor_signatures` Table
```sql
CREATE TABLE rams_visitor_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rams_document_id UUID REFERENCES rams_documents(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_company TEXT,
  visitor_role TEXT,
  signature_data TEXT NOT NULL,  -- Base64 signature image
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- Employee who facilitated
  UNIQUE(rams_document_id, visitor_name, visitor_company)
);
```

### Supabase Storage Bucket

**Bucket Name**: `rams-documents`

**Configuration**:
- Public: No (authenticated access only)
- File size limit: 10MB
- Allowed MIME types: 
  - `application/pdf`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
- RLS Policies:
  - Managers/Admins: Full access (upload, read, delete)
  - Employees: Read-only access to assigned documents

---

## 🎨 User Interface

### Dashboard Card

Replace one of the placeholder cards with:

```
┌─────────────────────────────────┐
│  📋 RAMS Documents              │
│                                 │
│  [Badge: 2 to sign]            │
│                                 │
│  Review & sign safety docs      │
│                                 │
│  [View All →]                   │
└─────────────────────────────────┘
```

**Badge Logic**:
- Shows count of unsigned RAMS documents assigned to the user
- Red badge for pending items
- No badge if all caught up

### Main RAMS Page (`/rams`)

**Manager/Admin View**:

```
┌──────────────────────────────────────────────┐
│  RAMS Documents                    [+ Upload]│
├──────────────────────────────────────────────┤
│                                              │
│  [Search: Filter by title...]               │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ ⚠️ Site Safety Induction (v2)          │ │
│  │ Uploaded: Oct 15, 2025                 │ │
│  │ Signed: 12/15 employees                │ │
│  │ [View Details] [Send to Employees]     │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ 🏗️ Working at Heights Method            │ │
│  │ Uploaded: Oct 10, 2025                 │ │
│  │ Signed: 8/8 employees                  │ │
│  │ [View Details] [Send to Employees]     │ │
│  └────────────────────────────────────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

**Employee View**:

```
┌──────────────────────────────────────────────┐
│  My RAMS Documents                          │
├──────────────────────────────────────────────┤
│                                              │
│  [Filter: All | Pending | Signed]           │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ ⚠️ Site Safety Induction (v2)    🔴    │ │
│  │ Assigned: Oct 25, 2025                 │ │
│  │ Status: Needs Your Signature           │ │
│  │ [Read & Sign →]                        │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ 🏗️ Working at Heights Method      ✅    │ │
│  │ Signed: Oct 12, 2025                   │ │
│  │ [View Document]                        │ │
│  └────────────────────────────────────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

### Upload Modal (`Manager/Admin`)

```
┌──────────────────────────────────────────┐
│  Upload RAMS Document              [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  Document Title *                        │
│  [________________________]              │
│                                          │
│  Description (Optional)                  │
│  [________________________]              │
│  [________________________]              │
│                                          │
│  Upload File * (PDF or DOCX, max 10MB)  │
│  [Choose File] safety-induction.pdf      │
│                                          │
│  ℹ️ After uploading, you can assign     │
│     this document to employees.          │
│                                          │
│  [Cancel]              [Upload Document] │
└──────────────────────────────────────────┘
```

### Assign to Employees Modal

```
┌──────────────────────────────────────────┐
│  Assign RAMS Document              [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  Document: Site Safety Induction (v2)    │
│                                          │
│  Select Employees:                       │
│                                          │
│  [Search employees...]                   │
│                                          │
│  ☑️ Select All                           │
│                                          │
│  ☑️ John Smith (Employee)                │
│  ☑️ Sarah Jones (Employee)               │
│  ☐ Mike Davis (Manager) ⚠️ Already signed│
│  ☑️ Emma Wilson (Employee)               │
│  ☑️ Tom Brown (Employee)                 │
│                                          │
│  5 employees selected                    │
│                                          │
│  [Cancel]                     [Assign →] │
└──────────────────────────────────────────┘
```

### Document Reader View (`/rams/[id]/read`)

**Layout**: Full-screen document viewer with sticky action bar

```
┌──────────────────────────────────────────────┐
│  [← Back]  Site Safety Induction (v2)       │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │                                        │ │
│  │   [PDF/DOCX Document Viewer]          │ │
│  │                                        │ │
│  │   Content displays here...            │ │
│  │                                        │ │
│  │                                        │ │
│  │                                        │ │
│  │                                        │ │
│  │   [Scroll Progress: 45%]              │ │
│  │                                        │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ⚠️ Please scroll to the bottom to continue  │
│                                              │
└──────────────────────────────────────────────┘

[When scrolled to bottom, sticky banner appears:]

┌──────────────────────────────────────────────┐
│  ✅ You've read the entire document.        │
│     [Click here to sign and confirm →]      │
└──────────────────────────────────────────────┘
```

### Signature Modal (Reuse Existing Component)

Same signature component used for timesheets and inspections, but with RAMS-specific text:

```
┌──────────────────────────────────────────┐
│  Confirm RAMS Acknowledgment       [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  By signing, you confirm that you have:  │
│  • Read the entire document              │
│  • Understood the safety requirements    │
│  • Agree to follow the method statement  │
│                                          │
│  [Signature Canvas]                      │
│  [Draw your signature here]              │
│                                          │
│  [Clear]              [Cancel] [Confirm] │
└──────────────────────────────────────────┘
```

### Visitor Signature Option

Button appears for employees who have already signed:

```
┌──────────────────────────────────────────┐
│  ✅ You signed this on Oct 12, 2025      │
│                                          │
│  Need to record a visitor signature?     │
│  [Record Visitor Signature]              │
└──────────────────────────────────────────┘
```

**Visitor Signature Modal**:

```
┌──────────────────────────────────────────┐
│  Record Visitor Signature          [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  Visitor Name *                          │
│  [________________________]              │
│                                          │
│  Company                                 │
│  [________________________]              │
│                                          │
│  Role/Position                           │
│  [________________________]              │
│                                          │
│  [Signature Canvas]                      │
│  [Draw visitor's signature here]         │
│                                          │
│  [Clear]              [Cancel] [Confirm] │
└──────────────────────────────────────────┘
```

### RAMS Details Page (`/rams/[id]`) - Manager/Admin

```
┌──────────────────────────────────────────────┐
│  [← Back]  Site Safety Induction (v2)       │
├──────────────────────────────────────────────┤
│  📋 Document Details                         │
│                                              │
│  File: safety-induction-v2.pdf (2.4 MB)     │
│  Uploaded: Oct 15, 2025 by Admin User       │
│  Version: 2                                  │
│                                              │
│  [Download PDF] [Send to Employees]          │
│  [Export with Signatures]                    │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  📊 Signature Status                         │
│                                              │
│  Progress: 12/15 employees signed (80%)      │
│  [Progress bar ████████░░ 80%]              │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  ✅ Signed (12)                              │
│  • John Smith - Oct 16, 2025 [View Sig]     │
│  • Sarah Jones - Oct 16, 2025 [View Sig]    │
│  • Emma Wilson - Oct 17, 2025 [View Sig]    │
│  ... (9 more)                                │
│                                              │
│  ⚠️ Pending (3)                              │
│  • Tom Brown - Assigned Oct 15               │
│  • Lisa Green - Assigned Oct 15              │
│  • Mark Taylor - Assigned Oct 15             │
│                                              │
│  👥 Visitor Signatures (2)                   │
│  • Mike Johnson (ABC Contractors) - Oct 17  │
│  • Sarah Williams (XYZ Ltd) - Oct 18        │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 🔄 User Workflows

### Workflow 1: Manager Uploads & Assigns RAMS

```
1. Manager clicks "RAMS" on dashboard
2. Manager clicks "+ Upload" button
3. Manager fills in title, description, selects PDF/DOCX file
4. Manager clicks "Upload Document"
5. Document uploaded to Supabase Storage
6. Database record created in rams_documents
7. Manager redirected to document details page
8. Manager clicks "Send to Employees"
9. Manager selects employees from list
10. Manager clicks "Assign"
11. Database records created in rams_assignments (one per employee)
12. Employees see badge notification on RAMS card
13. (Optional) Email notifications sent to employees
```

### Workflow 2: Employee Reads & Signs RAMS

```
1. Employee logs in, sees badge "2 to sign" on RAMS card
2. Employee clicks RAMS card
3. Employee sees list of pending RAMS documents
4. Employee clicks "Read & Sign" on a document
5. Document viewer opens (PDF/DOCX rendered)
6. Employee scrolls through document
7. Scroll progress tracked (must reach 100%)
8. When at 100%, sticky banner appears: "Click here to sign"
9. Employee clicks banner
10. Signature modal opens
11. Employee draws signature
12. Employee clicks "Confirm"
13. Signature saved to rams_assignments
14. Status updated to 'signed', signed_at timestamp recorded
15. Employee redirected to RAMS list
16. Badge count decrements
17. Manager sees updated compliance status
```

### Workflow 3: Employee Records Visitor Signature

```
1. Employee opens a RAMS document they've already signed
2. Employee sees "Record Visitor Signature" button
3. Employee clicks button
4. Visitor signature modal opens
5. Employee enters visitor name, company, role
6. Visitor draws signature on employee's device
7. Employee clicks "Confirm"
8. Signature saved to rams_visitor_signatures
9. Manager sees visitor signature in document details
10. Visitor signature included in exports
```

### Workflow 4: Manager Exports RAMS with Signatures

```
1. Manager opens RAMS document details
2. Manager clicks "Export with Signatures"
3. System generates PDF report:
   - Page 1-N: Original RAMS document
   - Page N+1: Signature summary page
     - Employee signatures table (name, date, signature image)
     - Visitor signatures table (name, company, date, signature image)
4. PDF downloads to manager's device
5. Manager can share with client/inspector for compliance proof
```

---

## 🛠️ Technical Implementation

### Phase 1: Database & Storage Setup (Day 1)

**Tasks**:
- [ ] Create database migration for `rams_documents` table
- [ ] Create database migration for `rams_assignments` table
- [ ] Create database migration for `rams_visitor_signatures` table
- [ ] Create Supabase Storage bucket `rams-documents`
- [ ] Configure RLS policies for all tables
- [ ] Configure storage bucket policies
- [ ] Update TypeScript types in `types/database.ts`

**Files to Create/Modify**:
- `supabase/create-rams-tables.sql`
- `scripts/setup-rams-storage.ts`
- `types/database.ts`
- `types/rams.ts` (new)

### Phase 2: File Upload & Storage (Day 2)

**Tasks**:
- [ ] Create API route for file upload: `POST /api/rams/upload`
- [ ] Implement file validation (size, type)
- [ ] Upload file to Supabase Storage
- [ ] Create database record
- [ ] Handle errors gracefully

**Files to Create**:
- `app/api/rams/upload/route.ts`
- `lib/utils/file-validation.ts`

### Phase 3: Manager UI - Upload & List (Day 3)

**Tasks**:
- [ ] Create RAMS list page: `/app/(dashboard)/rams/page.tsx`
- [ ] Create upload modal component
- [ ] Implement file selection and preview
- [ ] Integrate with upload API
- [ ] Display list of uploaded documents
- [ ] Show signature statistics per document

**Files to Create**:
- `app/(dashboard)/rams/page.tsx`
- `components/rams/UploadModal.tsx`
- `components/rams/RAMSCard.tsx`

### Phase 4: Assignment System (Day 4)

**Tasks**:
- [ ] Create API route: `POST /api/rams/[id]/assign`
- [ ] Create "Assign to Employees" modal
- [ ] Fetch list of employees
- [ ] Multi-select UI with search
- [ ] Create assignments in database
- [ ] Update document details UI

**Files to Create**:
- `app/api/rams/[id]/assign/route.ts`
- `components/rams/AssignEmployeesModal.tsx`

### Phase 5: Employee UI - List & Notifications (Day 5)

**Tasks**:
- [ ] Update RAMS page for employee view
- [ ] Show pending vs signed documents
- [ ] Implement badge logic for dashboard card
- [ ] Filter by status
- [ ] Update dashboard card on `/app/page.tsx`

**Files to Modify**:
- `app/(dashboard)/rams/page.tsx` (add role-based rendering)
- `app/(dashboard)/dashboard/page.tsx` (add RAMS card)

### Phase 6: Document Viewer (Day 6-7)

**Tasks**:
- [ ] Create document viewer page: `/app/(dashboard)/rams/[id]/read/page.tsx`
- [ ] Implement PDF rendering (using `react-pdf` or `pdfjs`)
- [ ] Implement DOCX rendering (using `mammoth.js` or similar)
- [ ] Track scroll progress
- [ ] Show sticky banner when fully scrolled
- [ ] Mark as "read" in database

**Libraries to Install**:
```bash
npm install react-pdf @react-pdf/renderer
npm install mammoth  # For DOCX rendering
```

**Files to Create**:
- `app/(dashboard)/rams/[id]/read/page.tsx`
- `components/rams/DocumentViewer.tsx`
- `lib/utils/document-renderer.ts`

### Phase 7: Signature Capture (Day 8)

**Tasks**:
- [ ] Reuse existing SignaturePad component
- [ ] Create signature modal for RAMS
- [ ] Create API route: `POST /api/rams/[id]/sign`
- [ ] Save signature to database
- [ ] Update assignment status
- [ ] Redirect after signing

**Files to Create**:
- `app/api/rams/[id]/sign/route.ts`
- `components/rams/SignRAMSModal.tsx` (wrapper around SignaturePad)

### Phase 8: Visitor Signatures (Day 9)

**Tasks**:
- [ ] Add "Record Visitor Signature" button to signed documents
- [ ] Create visitor signature modal
- [ ] Create API route: `POST /api/rams/[id]/visitor-signature`
- [ ] Save visitor signature to database
- [ ] Display visitor signatures in document details

**Files to Create**:
- `app/api/rams/[id]/visitor-signature/route.ts`
- `components/rams/VisitorSignatureModal.tsx`

### Phase 9: Manager Details View (Day 10)

**Tasks**:
- [ ] Create document details page: `/app/(dashboard)/rams/[id]/page.tsx`
- [ ] Show document metadata
- [ ] Show signature progress (percentage, progress bar)
- [ ] List signed employees with timestamps
- [ ] List pending employees
- [ ] List visitor signatures
- [ ] Add "Download" and "Export" buttons

**Files to Create**:
- `app/(dashboard)/rams/[id]/page.tsx`
- `components/rams/SignatureProgress.tsx`
- `components/rams/SignatureList.tsx`

### Phase 10: Reports & Export (Day 11-12)

**Tasks**:
- [ ] Create API route: `GET /api/rams/[id]/export`
- [ ] Generate PDF with original document + signature page
- [ ] Use `@react-pdf/renderer` to create signature summary page
- [ ] Include employee signatures (name, date, signature image)
- [ ] Include visitor signatures
- [ ] Add RAMS section to Reports page
- [ ] Allow managers to export any RAMS document

**Files to Create**:
- `app/api/rams/[id]/export/route.ts`
- `lib/pdf/rams-export.tsx`
- Modify: `app/(dashboard)/reports/page.tsx`

### Phase 11: Testing & Polish (Day 13)

**Tasks**:
- [ ] Test upload flow (PDF, DOCX)
- [ ] Test assignment flow
- [ ] Test employee read & sign flow
- [ ] Test visitor signature flow
- [ ] Test export with signatures
- [ ] Test on mobile (PWA)
- [ ] Error handling and validation
- [ ] Loading states and skeletons
- [ ] Toast notifications

---

## 📊 Data Flow Diagrams

### Upload & Assignment Flow

```
Manager -> Upload Modal -> API (/api/rams/upload)
                             |
                             v
                   Supabase Storage (file)
                             |
                             v
                   rams_documents table (metadata)
                             |
                             v
Manager <- Document Details <- Database

Manager -> Assign Modal -> API (/api/rams/[id]/assign)
                             |
                             v
                   rams_assignments table (bulk insert)
                             |
                             v
Employees <- Notification Badge <- Database
```

### Employee Read & Sign Flow

```
Employee -> RAMS List -> Document Viewer (/rams/[id]/read)
                             |
                             v
                   Supabase Storage (fetch file)
                             |
                             v
                   Render PDF/DOCX
                             |
                             v
                   Track Scroll (100%?)
                             |
                             v
                   Show "Sign" Banner
                             |
                             v
Employee -> Signature Modal -> API (/api/rams/[id]/sign)
                             |
                             v
                   rams_assignments (update)
                             |
                             v
Manager <- Compliance Dashboard <- Database
```

---

## 🔒 Security & Permissions

### Role-Based Access Control (RBAC)

| Feature | Admin | Manager | Employee |
|---------|-------|---------|----------|
| Upload RAMS | ✅ | ✅ | ❌ |
| Assign to Employees | ✅ | ✅ | ❌ |
| View All RAMS | ✅ | ✅ | ❌ |
| View Assigned RAMS | ✅ | ✅ | ✅ (own only) |
| Read RAMS | ✅ | ✅ | ✅ (assigned only) |
| Sign RAMS | ✅ | ✅ | ✅ (assigned only) |
| Record Visitor Signature | ✅ | ✅ | ✅ (if already signed) |
| Export with Signatures | ✅ | ✅ | ❌ |
| Delete RAMS | ✅ | ✅ | ❌ |

### RLS Policies

**`rams_documents`**:
```sql
-- Admins and managers can view all
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

-- Managers can insert
CREATE POLICY "Managers can create RAMS documents" ON rams_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );
```

**`rams_assignments`**:
```sql
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

-- Employees can update their own signatures
CREATE POLICY "Employees can sign their assignments" ON rams_assignments
  FOR UPDATE USING (employee_id = auth.uid());
```

**Storage Bucket**: `rams-documents`

```sql
-- Managers can upload
CREATE POLICY "Managers can upload RAMS" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'rams-documents' AND
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Users can download assigned documents
CREATE POLICY "Users can download assigned RAMS" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'rams-documents' AND (
      -- Managers can access all
      EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() 
        AND role IN ('admin', 'manager')
      ) OR
      -- Employees can access assigned
      EXISTS (
        SELECT 1 FROM rams_assignments ra
        JOIN rams_documents rd ON rd.id = ra.rams_document_id
        WHERE rd.file_path = storage.objects.name
        AND ra.employee_id = auth.uid()
      )
    )
  );
```

---

## 📱 Mobile Considerations

- ✅ **Touch-friendly UI**: Large buttons, swipeable cards
- ✅ **Offline capability**: Cache viewed documents (future enhancement)
- ✅ **Signature on mobile**: Existing SignaturePad works well on touch
- ✅ **File size warnings**: Warn before downloading large files on mobile data
- ✅ **Document rendering**: Test PDF rendering on iOS Safari and Android Chrome
- ✅ **Portrait-optimized**: Document viewer works in portrait mode

---

## 🧪 Testing Checklist

### Functional Tests

- [ ] Manager can upload PDF document
- [ ] Manager can upload DOCX document
- [ ] File validation rejects invalid files (>10MB, wrong type)
- [ ] Manager can assign document to multiple employees
- [ ] Employee sees badge notification for pending RAMS
- [ ] Employee can view assigned documents
- [ ] Document viewer renders PDF correctly
- [ ] Document viewer renders DOCX correctly
- [ ] Scroll tracking works (100% detection)
- [ ] Signature modal opens after full scroll
- [ ] Employee can sign document
- [ ] Signature saves to database
- [ ] Badge count decrements after signing
- [ ] Manager sees updated signature status
- [ ] Employee can record visitor signature
- [ ] Visitor signature saves correctly
- [ ] Manager can export RAMS with signatures
- [ ] Export includes all signatures (employees + visitors)

### Security Tests

- [ ] Employees cannot access unassigned RAMS
- [ ] Employees cannot upload RAMS
- [ ] Employees cannot assign RAMS
- [ ] Employees cannot export RAMS
- [ ] Managers can only access their organization's RAMS (if multi-tenant)
- [ ] File upload validates MIME type on server-side
- [ ] RLS policies prevent unauthorized database access

### Performance Tests

- [ ] Large PDF (10MB) uploads successfully
- [ ] Large PDF renders without crashing
- [ ] List page loads quickly with 50+ documents
- [ ] Signature export generates in <5 seconds

### Mobile Tests

- [ ] Upload works on mobile (file picker)
- [ ] Document viewer works on iPhone Safari
- [ ] Document viewer works on Android Chrome
- [ ] Signature works on touch screen
- [ ] Scroll detection works on mobile
- [ ] PWA offline mode (future enhancement)

---

## 📈 Success Metrics

**Adoption**:
- 80% of employees sign new RAMS within 7 days
- Managers upload average 2+ RAMS documents per month

**Compliance**:
- 100% of required employees sign RAMS before site work
- Zero compliance violations due to unsigned RAMS

**Efficiency**:
- 50% reduction in time spent managing paper RAMS
- 90% reduction in printing costs for safety documents

**User Satisfaction**:
- 4+ star rating for RAMS feature in user feedback
- <5% support requests related to RAMS

---

## 🚀 Future Enhancements (Phase 2)

### Version Control
- Track RAMS document versions
- Require re-signing when new version uploaded
- Show version history

### Expiry & Reminders
- Set expiry dates for RAMS (e.g., annual renewal)
- Send reminders to employees before expiry
- Auto-reassign on expiry

### Offline Reading
- Cache RAMS documents for offline reading
- Queue signatures for upload when back online

### Email Notifications
- Notify employees when assigned new RAMS
- Remind employees of pending RAMS (weekly digest)
- Notify managers when all employees have signed

### Templates
- Pre-defined RAMS templates library
- Quick-create from template
- Organization-specific template library

### Audit Trail
- Detailed activity log (who, what, when)
- Export audit trail for compliance
- Show document access history

### Multi-language Support
- Upload RAMS in multiple languages
- Employee selects preferred language
- All UI text translated

### QR Code Signing
- Generate QR code for RAMS document
- Visitor scans QR to sign on their own device
- No need for employee facilitation

---

## 📅 Implementation Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Database Setup | 1 day | Tables, RLS, Storage bucket |
| Phase 2: File Upload | 1 day | Upload API working |
| Phase 3: Manager UI | 1 day | Upload and list working |
| Phase 4: Assignment | 1 day | Assign to employees working |
| Phase 5: Employee UI | 1 day | Employee list view |
| Phase 6-7: Document Viewer | 2 days | Read documents with scroll tracking |
| Phase 8: Signatures | 1 day | Sign documents |
| Phase 9: Visitor Signatures | 1 day | Record visitor signatures |
| Phase 10: Details View | 1 day | Manager compliance dashboard |
| Phase 11-12: Export | 2 days | Export with signatures |
| Phase 13: Testing | 1 day | Full QA pass |

**Total Estimated Time**: 13 days (~2.5 weeks)

---

## ❓ Open Questions

1. **File format support**: Should we support other formats beyond PDF/DOCX? (e.g., images, PowerPoint)
2. **Email notifications**: Do we want automatic email notifications, or just in-app badges?
3. **Expiry dates**: Should RAMS have expiry dates that require re-signing?
4. **Bulk operations**: Should managers be able to bulk-assign one RAMS to all employees?
5. **Document editing**: Should managers be able to replace/edit documents after upload?
6. **Visitor tracking**: Do visitors need unique IDs or is name+company sufficient?
7. **Compliance reports**: Do we need separate compliance reports beyond the export feature?

---

## 📚 Related Documentation

- `TEMPLATE_APP_PROPOSAL.md` - Original PRD
- `PRD_IMPLEMENTATION_STATUS.md` - Overall implementation status
- `OFFLINE_PWA_IMPLEMENTATION.md` - PWA and offline features
- `types/database.ts` - Database types

---

**Status**: ✅ PRD Complete - Ready for Implementation  
**Next Step**: Review with client, then proceed to Phase 1 (Database Setup)

