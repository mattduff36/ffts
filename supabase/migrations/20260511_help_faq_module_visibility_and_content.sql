-- Add module visibility gates to FAQ categories and refresh help content for the current app surface.

ALTER TABLE public.faq_categories
  ADD COLUMN IF NOT EXISTS module_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'faq_categories_module_name_check'
  ) THEN
    ALTER TABLE public.faq_categories
      ADD CONSTRAINT faq_categories_module_name_check
      CHECK (
        module_name IS NULL OR module_name IN (
          'timesheets',
          'inspections',
          'plant-inspections',
          'hgv-inspections',
          'rams',
          'absence',
          'maintenance',
          'toolbox-talks',
          'workshop-tasks',
          'approvals',
          'actions',
          'reports',
          'suggestions',
          'faq-editor',
          'error-reports',
          'admin-users',
          'admin-settings',
          'admin-vans',
          'customers',
          'quotes',
          'inventory'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_faq_categories_module_name
  ON public.faq_categories(module_name);

UPDATE public.faq_categories
SET
  name = 'Van Daily Checks',
  description = 'Help for completing van daily checks and defect reporting.',
  module_name = 'inspections',
  sort_order = 3
WHERE slug = 'inspections';

UPDATE public.faq_categories
SET
  name = 'Projects',
  slug = 'projects',
  description = 'Help for project documents, signatures, and visitor sign-in.',
  module_name = 'rams',
  sort_order = 6
WHERE slug IN ('rams', 'projects');

UPDATE public.faq_categories
SET
  name = 'Maintenance',
  slug = 'maintenance',
  description = 'Help for maintenance schedules and service status.',
  module_name = 'maintenance',
  sort_order = 8
WHERE slug IN ('fleet-maintenance', 'maintenance');

INSERT INTO public.faq_categories (name, slug, description, module_name, sort_order, is_active)
VALUES
  ('Getting Started', 'getting-started', 'General app access, dashboard, and installation guidance.', NULL, 1, TRUE),
  ('Timesheets', 'timesheets', 'Help for creating, editing, and tracking timesheets.', 'timesheets', 2, TRUE),
  ('Van Daily Checks', 'inspections', 'Help for completing van daily checks and defect reporting.', 'inspections', 3, TRUE),
  ('Plant Daily Checks', 'plant-daily-checks', 'Help for completing plant machinery daily checks.', 'plant-inspections', 4, TRUE),
  ('HGV Daily Checks', 'hgv-daily-checks', 'Help for completing HGV daily checks.', 'hgv-inspections', 5, TRUE),
  ('Projects', 'projects', 'Help for project documents, signatures, and visitor sign-in.', 'rams', 6, TRUE),
  ('Absence & Leave', 'absence', 'Help for annual leave, calendars, allowances, and absence reporting.', 'absence', 7, TRUE),
  ('Maintenance', 'maintenance', 'Help for maintenance schedules and service status.', 'maintenance', 8, TRUE),
  ('Fleet', 'fleet', 'Help for fleet assets, vans, plant, HGVs, and asset history.', 'admin-vans', 9, TRUE),
  ('Workshop Tasks', 'workshop-tasks', 'Help for repair tasks, defects, comments, and workshop workflow.', 'workshop-tasks', 10, TRUE),
  ('Approvals', 'approvals', 'Help for reviewing timesheets and absence requests.', 'approvals', 11, TRUE),
  ('Manager Actions Hub', 'actions', 'Help for the manager action summary pages.', 'actions', 12, TRUE),
  ('Toolbox Talks & Reminders', 'toolbox-talks', 'Help for sending and tracking safety messages.', 'toolbox-talks', 13, TRUE),
  ('Reports', 'reports', 'Help for operational reports and exports.', 'reports', 14, TRUE),
  ('Customers', 'customers', 'Help for managing customer records and history.', 'customers', 15, TRUE),
  ('Quotes', 'quotes', 'Help for creating and tracking customer quotes.', 'quotes', 16, TRUE),
  ('Inventory', 'inventory', 'Help for stock, small tools, equipment, and locations.', 'inventory', 17, TRUE),
  ('User Management', 'admin-users', 'Help for admin user and role management.', 'admin-users', 18, TRUE),
  ('Roles & Permissions', 'admin-roles', 'Help for role and permission setup.', 'admin-users', 19, TRUE),
  ('Admin Settings', 'admin-settings', 'Help for admin-only settings and configuration.', 'admin-settings', 20, TRUE),
  ('FAQ Editor', 'faq-editor', 'Help for managing FAQ categories, articles, and visibility.', 'faq-editor', 21, TRUE),
  ('Error Reports', 'error-reports', 'Help for reviewing user-submitted error reports.', 'error-reports', 22, TRUE),
  ('Notifications & Messages', 'notifications', 'Help for notifications, reminders, and message acknowledgements.', NULL, 23, TRUE),
  ('Troubleshooting', 'troubleshooting', 'General support, refresh, login, and access-denied guidance.', NULL, 24, TRUE)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  module_name = EXCLUDED.module_name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

UPDATE public.faq_articles
SET category_id = (SELECT id FROM public.faq_categories WHERE slug = 'fleet')
WHERE slug IN ('manage-vehicles', 'fleet-overview', 'vehicle-categories')
  AND category_id = (SELECT id FROM public.faq_categories WHERE slug = 'maintenance');

CREATE OR REPLACE FUNCTION pg_temp.upsert_faq_article(
  p_category_slug TEXT,
  p_title TEXT,
  p_slug TEXT,
  p_summary TEXT,
  p_content_md TEXT,
  p_sort_order INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_category_id UUID;
BEGIN
  SELECT id INTO v_category_id
  FROM public.faq_categories
  WHERE slug = p_category_slug;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'FAQ category not found: %', p_category_slug;
  END IF;

  INSERT INTO public.faq_articles (
    category_id,
    title,
    slug,
    summary,
    content_md,
    is_published,
    sort_order
  )
  VALUES (
    v_category_id,
    p_title,
    p_slug,
    p_summary,
    p_content_md,
    TRUE,
    p_sort_order
  )
  ON CONFLICT (category_id, slug) DO UPDATE
  SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    content_md = EXCLUDED.content_md,
    is_published = TRUE,
    sort_order = EXCLUDED.sort_order;
END;
$$;

SELECT pg_temp.upsert_faq_article(
  'getting-started',
  'What is the FOREST FARM App?',
  'what-is-forest-farm-operations',
  'Overview of the FOREST FARM digital work management system.',
  $md$# What is the FOREST FARM App?

Forest Farm Operations is the Forest Farm Tree Services digital work management app. It replaces paper forms and shared spreadsheets with a mobile-first web app for daily site and office workflows.

## What it covers

The modules you see depend on your role and permissions. Common areas include:

- Timesheets
- Van, plant, and HGV daily checks
- Projects documents and signatures
- Absence and leave
- Maintenance, fleet, workshop tasks, and inventory
- Approvals, reports, customers, quotes, toolbox talks, and admin tools

## Access

Open the Forest Farm Operations app at the URL provided by your administrator and sign in with your work account.

The app works on desktop, tablet, and mobile. For regular phone or tablet use, install it from the Help page so it opens like a normal app.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'getting-started',
  'Understanding the Dashboard',
  'dashboard-overview',
  'Guide to the main dashboard and permission-based navigation.',
  $md$# Understanding the Dashboard

The Dashboard is your home screen after signing in. It shows quick links for the modules you can access and hides modules that are not enabled for your current role or team.

## Quick actions

The large action cards open day-to-day modules such as Timesheets, Daily Checks, Projects, Absence, Maintenance, Fleet, Workshop, Inventory, and Help. If a module is not visible, your role does not currently have that permission.

## Management tools

Managers and admins may also see tools such as Approvals, Actions, Toolbox Talks, Reports, Suggestions, Customers, Quotes, User Management, Admin Settings, FAQ Editor, and Error Reports.

## Badges and alerts

Some cards show counts, such as documents awaiting signature, absence approvals, unread notifications, or maintenance/workshop alerts. Use the card to open the relevant page and review the detail.$md$,
  3
);

SELECT pg_temp.upsert_faq_article(
  'getting-started',
  'What are the different user roles?',
  'user-roles-explained',
  'Explanation of Employee, Manager, Admin, and Super Admin access.',
  $md$# What are the different user roles?

Your role and module permissions decide what you can see and do in FOREST FARM.

## Employee

Employees can use the day-to-day modules enabled for their role or team, such as Timesheets, Van Daily Checks, Plant Daily Checks, HGV Daily Checks, Projects, Absence, Maintenance, Workshop Tasks, Fleet, Inventory, or Help.

## Manager

Managers may also have access to approval and oversight tools, such as Approvals, Actions, Toolbox Talks, Reports, Suggestions, and selected admin workflows.

## Admin

Admins can manage system areas such as users, roles, permissions, customers, quotes, admin settings, FAQ content, fleet assets, and error reports, depending on the module permissions enabled.

## Super Admin

Super Admin is a protected high-access account type used for system administration and recovery.$md$,
  5
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'How do I perform a van daily check?',
  'create-inspection',
  'Step-by-step guide to completing a van daily check.',
  $md$# How do I perform a van daily check?

## Quick steps

1. Go to **Van Daily Checks**.
2. Click **New Daily Check**.
3. Select the van and week ending date.
4. Enter the current mileage.
5. Complete each daily checklist tab.
6. Add required comments for any failed item.
7. Save a draft or submit the check.

## Checklist rules

Van daily checks use the van checklist for items such as fluids, tyres, lights, mirrors, brakes, body condition, seat belt, and steering.

If you mark an item as failed, add a clear defect comment before submitting. Defects can create workshop follow-up tasks for managers to review.$md$,
  11
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'What happens when I report a van defect?',
  'inspection-defects',
  'How failed van check items become trackable workshop work.',
  $md$# What happens when I report a van defect?

When you mark a van daily check item as **Fail**, the app records the defect with your comments.

## What managers see

Defects can be reviewed in daily check reports and workshop workflows. If a repair is needed, a linked Workshop Task can be created or updated so the issue is tracked through to completion.

## What to include

Add practical detail, such as:

- What is wrong
- Which side or part is affected
- Whether the vehicle can still be used safely
- Any temporary action already taken

Clear comments help the workshop and managers resolve the defect faster.$md$,
  12
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'What items are on the van daily check?',
  'inspection-checklists',
  'Summary of the van daily check checklist.',
  $md$# What items are on the van daily check?

The van daily check covers the main safety and condition items needed before use.

## Typical van checklist

1. Oil, fuel, coolant levels, and leaks
2. Wheels and nuts
3. Tyres
4. Windows and wipers
5. Mirrors
6. Visual body condition
7. Lights and flashing beacons
8. Instrument gauges and horn
9. Seat belt
10. Visual interior condition
11. Locking devices
12. Steering
13. Parking brake
14. Brake test

Plant and HGV checks now have their own modules and FAQ categories because their forms and compliance needs are different.$md$,
  13
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'What do van daily check statuses mean?',
  'inspection-statuses',
  'Explanation of van daily check draft and submitted statuses.',
  $md$# What do van daily check statuses mean?

## Draft

The daily check has been saved but not submitted. You can return to complete or edit it.

## Submitted

The daily check has been submitted. Any defects are available for manager review and workshop follow-up.

Daily checks do not use the same approval workflow as timesheets. Defects are handled through reports, maintenance review, and workshop tasks.$md$,
  14
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'How do I add a van during a daily check?',
  'add-vehicle-inspection',
  'Adding a van that is not yet in the daily check list.',
  $md$# How do I add a van during a daily check?

If the van you need is not available in the dropdown, use the add option shown in the van selector if your permissions allow it.

Enter the required asset details carefully, especially the registration or identifier. The new van can then be selected for the daily check.

If you cannot add a van, ask a manager or admin with Fleet access to create the asset first.$md$,
  16
);

SELECT pg_temp.upsert_faq_article(
  'inspections',
  'Why can I not create a van daily check?',
  'duplicate-inspection',
  'Understanding duplicate daily check prevention.',
  $md$# Why can I not create a van daily check?

The app prevents duplicate daily checks for the same van and reporting period.

If you see a duplicate warning:

- Check whether a draft already exists.
- Confirm you selected the correct van.
- Confirm the date or week ending is correct.
- Open the existing check instead of creating a second one.

This prevents conflicting records for the same asset and period.$md$,
  17
);

SELECT pg_temp.upsert_faq_article(
  'plant-daily-checks',
  'How do I complete a plant daily check?',
  'create-plant-daily-check',
  'Step-by-step guide to completing a plant machinery daily check.',
  $md$# How do I complete a plant daily check?

## Quick steps

1. Go to **Plant Daily Checks**.
2. Click **New Plant Daily Check**.
3. Select the plant item.
4. Enter the required meter or hours reading.
5. Complete the checklist for the day or week shown on the form.
6. Add a comment for any failed item.
7. Save a draft or submit the check.

## Defects

Failed items should describe the fault clearly. Plant defects can feed into workshop or maintenance follow-up depending on the issue and manager review.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'plant-daily-checks',
  'Where do I find plant check history?',
  'plant-check-history',
  'How to review submitted plant checks and related history.',
  $md$# Where do I find plant check history?

Open **Plant Daily Checks** to see submitted and draft checks you can access.

Managers and admins can also use **Fleet** asset history for plant records when reviewing long-term maintenance, checks, and repair activity for a specific plant item.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'hgv-daily-checks',
  'How do I complete an HGV daily check?',
  'create-hgv-daily-check',
  'Step-by-step guide to completing an HGV daily check.',
  $md$# How do I complete an HGV daily check?

## Quick steps

1. Go to **HGV Daily Checks**.
2. Click **New HGV Daily Check**.
3. Select the HGV.
4. Enter the mileage or odometer reading.
5. Complete all required checklist items.
6. Add defect comments where needed.
7. Save a draft or submit the check.

## HGV-specific checks

HGV checks are separate from van checks and include HGV compliance items such as tyres, brakes, lights, reflectors, markers, safety equipment, load security, and other vehicle-specific checks.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'hgv-daily-checks',
  'How is HGV mileage used?',
  'hgv-mileage-history',
  'How HGV daily check mileage supports asset history.',
  $md$# How is HGV mileage used?

Mileage entered on HGV daily checks helps keep the asset record current.

Managers and admins can use HGV history in **Fleet** to review submitted checks, mileage movement, maintenance records, and repair activity for a specific HGV.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'projects',
  'What are Projects documents?',
  'what-is-rams',
  'Overview of the Projects document and signature workflow.',
  $md$# What are Projects documents?

The Projects module is where project documents, including RAMS-style safety documents, are uploaded, assigned, read, and signed.

## What employees do

Employees can view assigned project documents, read the PDF, and sign to confirm they have read and understood the information.

## What managers do

Managers and admins can upload documents, assign them to employees, track signatures, and record visitor signatures where needed.$md$,
  14
);

SELECT pg_temp.upsert_faq_article(
  'projects',
  'How do I view and sign project documents?',
  'view-sign-rams',
  'Instructions for reading and signing assigned project documents.',
  $md$# How do I view and sign project documents?

1. Go to **Projects**.
2. Open the document assigned to you.
3. Read the PDF in the viewer.
4. Sign when you have read and understood it.

Documents you have already signed remain available for reference. Pending documents may also show on the Dashboard or navigation badges.$md$,
  15
);

SELECT pg_temp.upsert_faq_article(
  'projects',
  'How do visitors sign project documents?',
  'rams-visitor-signature',
  'Recording visitor signatures for project document compliance.',
  $md$# How do visitors sign project documents?

Visitor signatures are used when someone without an app account needs to acknowledge a project document.

1. Open the relevant document in **Projects**.
2. Choose the visitor signature option.
3. Enter the visitor name.
4. Ask the visitor to sign on the signature pad.
5. Submit the signature.

The app records the visitor name, signature, timestamp, document, and the user who captured the signature.$md$,
  16
);

SELECT pg_temp.upsert_faq_article(
  'projects',
  'How do I upload project documents? (Managers)',
  'upload-rams-manager',
  'Instructions for uploading and assigning project documents.',
  $md$# How do I upload project documents? (Managers)

Managers and admins with Projects access can upload and assign project documents.

## Uploading

1. Go to **Projects**.
2. Open the management or settings area.
3. Upload the PDF document.
4. Add a clear title and description.
5. Assign the document to the users who need to sign it.

Assigned users will see the document in Projects and can sign after reading.$md$,
  17
);

DELETE FROM public.faq_articles
WHERE slug IN (
    'what-are-projects',
    'view-sign-projects',
    'project-visitor-signature',
    'upload-project-documents'
  )
  AND category_id = (SELECT id FROM public.faq_categories WHERE slug = 'projects');

SELECT pg_temp.upsert_faq_article(
  'absence',
  'What absence reports are available?',
  'absence-reports',
  'Overview of absence and leave reports in the Reports hub.',
  $md$# What absence reports are available?

Managers and admins with Reports access can open **Reports** and choose **Absence & Leave**.

## Available absence reports

- **Absence & Leave Bookings** - approved active and archived bookings that overlap the selected date range.
- **Absence Allowance Snapshot** - employee allowance totals at a selected snapshot date.
- **Absence Weekly Print Sheet** - printable weekly day-by-day PDF with holidays and employees off.

Use the date controls at the top of the report tab before downloading.$md$,
  26
);

SELECT pg_temp.upsert_faq_article(
  'maintenance',
  'What is Maintenance?',
  'maintenance-overview',
  'Overview of the Maintenance page and service schedule checks.',
  $md$# What is Maintenance?

Maintenance shows service, MOT, tax, and other due-date or mileage-based checks for assets you can access.

## What you can see

The page highlights:

- Overdue items
- Items due soon
- Current maintenance status
- Maintenance schedule or service information

Fleet asset management and asset history are now covered separately under the **Fleet** category.$md$,
  20
);

SELECT pg_temp.upsert_faq_article(
  'maintenance',
  'How do I view maintenance status?',
  'view-maintenance',
  'Understanding overdue and due-soon maintenance status.',
  $md$# How do I view maintenance status?

Open **Maintenance** to review asset maintenance status.

## Status colours

- **Green** - OK
- **Amber** - due soon
- **Red** - overdue
- **Grey** - not applicable or not tracked

Use search and filters where available to narrow the list. Click through to the relevant asset or record when you need more detail.$md$,
  21
);

SELECT pg_temp.upsert_faq_article(
  'maintenance',
  'How do I configure maintenance settings? (Managers)',
  'maintenance-settings',
  'Configure maintenance thresholds and tracked categories.',
  $md$# How do I configure maintenance settings? (Managers)

Managers and admins with Maintenance access can configure maintenance settings.

## Common settings

- Warning periods before due dates
- Mileage or date thresholds
- Maintenance categories
- Which checks are tracked for an asset type

Use these settings carefully because they affect overdue and due-soon alerts across the app.$md$,
  22
);

SELECT pg_temp.upsert_faq_article(
  'fleet',
  'What is Fleet?',
  'fleet-overview',
  'Overview of fleet asset management and history.',
  $md$# What is Fleet?

Fleet is where managers and admins manage asset records such as vans, plant, and HGVs.

## What Fleet covers

- Asset lists and details
- Active/inactive status
- Asset categories
- Van, plant, and HGV history
- Links between checks, maintenance, and workshop activity

Maintenance due dates are handled in **Maintenance**. Repairs and defect work are handled in **Workshop Tasks**.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'fleet',
  'How do I view asset history?',
  'fleet-asset-history',
  'Where to find van, plant, and HGV history.',
  $md$# How do I view asset history?

Managers and admins can open **Fleet** and choose an asset to view its history.

## Available history

Depending on the asset type, history may include:

- Daily checks
- Mileage or hours readings
- Maintenance records
- Workshop tasks and defect follow-up

Use asset history when you need a timeline for a specific van, plant item, or HGV.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'fleet',
  'How do I manage fleet assets? (Admin)',
  'manage-vehicles',
  'Add, edit, and organize fleet assets.',
  $md$# How do I manage fleet assets? (Admin)

Admins and managers with Fleet access can manage asset records.

## Common actions

1. Open **Fleet**.
2. Choose the asset type or list.
3. Add or edit the asset details.
4. Set category, registration or identifier, status, and other required fields.
5. Save the changes.

Accurate asset records keep daily checks, maintenance, reports, and workshop tasks linked to the right asset.$md$,
  2
);

SELECT pg_temp.upsert_faq_article(
  'fleet',
  'How do I manage fleet categories?',
  'vehicle-categories',
  'Creating and editing fleet categories.',
  $md$# How do I manage fleet categories?

Fleet categories control how assets are grouped and which workflows apply.

## Managing categories

1. Open **Fleet** or the relevant settings area.
2. Find the category management section.
3. Add, edit, deactivate, or reorder categories as needed.

Only remove a category when no active assets depend on it. Deactivation is usually safer than deletion for historical records.$md$,
  3
);

SELECT pg_temp.upsert_faq_article(
  'workshop-tasks',
  'What is Workshop Tasks?',
  'workshop-overview',
  'Overview of workshop task management and repair tracking.',
  $md$# What is Workshop Tasks?

Workshop Tasks tracks repair and follow-up work.

## How tasks are created

Tasks can be:

- Created manually by managers
- Created from daily check defects
- Linked to van, plant, or HGV assets

## How it differs from Maintenance

**Maintenance** tracks due dates, service windows, and compliance status.

**Workshop Tasks** tracks actual repair jobs, defect follow-up, comments, status changes, and completion notes.$md$,
  30
);

SELECT pg_temp.upsert_faq_article(
  'toolbox-talks',
  'How do I track Toolbox Talk signatures?',
  'toolbox-reports',
  'Viewing who has signed or acknowledged Toolbox Talks and reminders.',
  $md$# How do I track Toolbox Talk signatures?

Managers and admins can use the reports area inside **Toolbox Talks** to review sent messages.

## What you can check

- Message title and type
- Date sent
- Total recipients
- Signed or acknowledged count
- Pending recipients
- Signature timestamps where required

Use this to follow up with users who have not signed required Toolbox Talks.$md$,
  36
);

SELECT pg_temp.upsert_faq_article(
  'reports',
  'What reports can I download?',
  'reports-overview',
  'Overview of the current Reports hub.',
  $md$# What reports can I download?

Managers and admins with Reports access can open **Reports** to download operational reports.

## Timesheets

- **Weekly Timesheet Summary** - daily hours, leave-aware totals, and did-not-work details.
- **Payroll Export** - approved worked hours with overtime and leave breakdown.

## Daily Checks

- **Daily Checks Compliance Summary** - completion and compliance across van, plant, and HGV checks.
- **Daily Checks Defects Log** - reported defects requiring review or follow-up.
- **Bulk Daily Check PDFs** - van, plant, and HGV checks in range as PDF output.

## Absence & Leave

- **Absence & Leave Bookings**
- **Absence Allowance Snapshot**
- **Absence Weekly Print Sheet**

## More Reports

Use **More Reports** to suggest future report ideas.$md$,
  37
);

SELECT pg_temp.upsert_faq_article(
  'reports',
  'How do I bulk download daily check PDFs?',
  'bulk-pdf-download',
  'Downloading multiple van, plant, and HGV checks as PDFs.',
  $md$# How do I bulk download daily check PDFs?

1. Go to **Reports**.
2. Open the **Daily Checks** report tab.
3. Set the date range.
4. Click **Download** on **Bulk Daily Check PDFs**.
5. Wait for generation to finish.

For large date ranges, the app may split the download into multiple files or a ZIP. The progress indicator shows how many checks are being processed.$md$,
  38
);

SELECT pg_temp.upsert_faq_article(
  'reports',
  'How do I suggest a new report?',
  'suggest-report',
  'Using the More Reports tab to request future reports.',
  $md$# How do I suggest a new report?

1. Open **Reports**.
2. Choose **More Reports**.
3. Enter a report name.
4. Describe what the report should show.
5. Click **Add Suggestion**.

Report suggestions help managers and admins understand which exports would be useful next.$md$,
  39
);

SELECT pg_temp.upsert_faq_article(
  'customers',
  'How do I manage customers?',
  'customers-overview',
  'Overview of customer records and history.',
  $md$# How do I manage customers?

Users with Customers access can open **Customers** to manage customer records.

## Typical actions

- Add a customer
- Edit contact or company details
- Review customer history
- Link customer records to quotes or related work

Keep customer details accurate so quotes and future records use the correct information.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'quotes',
  'How do I create and track quotes?',
  'quotes-overview',
  'Overview of the Quotes module and quote workflow.',
  $md$# How do I create and track quotes?

Users with Quotes access can open **Quotes** to create and manage customer quotations.

## Quote workflow

Use the Quotes page to:

- Create a new quote
- Select or create the customer
- Add quote details and line items
- Track status as the quote moves through review, acceptance, or decline
- Review quote history and related work calendar information where available

Keep quote titles and customer details clear so reports and history stay useful.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'quotes',
  'What is the quotes work calendar?',
  'quotes-work-calendar',
  'Using the quote work calendar for planned quoted work.',
  $md$# What is the quotes work calendar?

The quote work calendar helps teams see planned or scheduled work linked to quotes.

Use it to understand timing, avoid clashes, and review quote-related work in calendar form. Access depends on the Quotes permission.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'inventory',
  'What is Inventory?',
  'inventory-overview',
  'Overview of stock, small tools, equipment, and location tracking.',
  $md$# What is Inventory?

Inventory tracks small tools, equipment, consumables, and where items are stored.

## What you can do

Depending on permissions, you can:

- View inventory items
- Search by item, category, or location
- Review quantities and status
- Manage storage locations
- Track item movement or updates

Use Inventory when you need to check what equipment is available and where it should be.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'inventory',
  'How do inventory locations work?',
  'inventory-locations',
  'Understanding location buckets and item storage.',
  $md$# How do inventory locations work?

Inventory locations describe where an item is stored, such as a yard, container, vehicle, store room, or other bucket.

Managers can use locations to keep stock organized and make it easier for users to find the right item without searching through unrelated areas.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'admin-users',
  'How do I manage users? (Admin)',
  'user-management-overview',
  'Overview of user administration.',
  $md$# How do I manage users? (Admin)

Admins with User Management access can open **Users** to manage app accounts.

## Common actions

- Create users
- Edit profile details
- Reset passwords
- Assign roles
- Review user status
- Delete or deactivate accounts according to company process

Role and permission settings control which modules each user can access.$md$,
  39
);

SELECT pg_temp.upsert_faq_article(
  'admin-roles',
  'How do roles and permissions work?',
  'roles-overview',
  'Understanding role-based module access.',
  $md$# How do roles and permissions work?

FOREST FARM uses role and team permissions to decide which modules a user can access.

## Module permissions

Each role or team setup can grant access to modules such as Timesheets, Daily Checks, Projects, Absence, Maintenance, Fleet, Workshop Tasks, Reports, Quotes, Inventory, and admin tools.

## Full access roles

Admin and super admin roles can have full access. View As and effective role behavior can change what a user sees while testing another role.

FAQ categories use the same module names, so restricted FAQ content is only returned to users with the matching module access.$md$,
  43
);

SELECT pg_temp.upsert_faq_article(
  'admin-settings',
  'What is Admin Settings?',
  'admin-settings-overview',
  'Overview of admin-only configuration tools.',
  $md$# What is Admin Settings?

Admin Settings contains configuration tools that affect the wider app.

## Examples

Depending on what is enabled, admins may use settings to manage app-wide behavior, module configuration, support preferences, or operational defaults.

Only users with the **Admin Settings** module permission should see this FAQ category.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'faq-editor',
  'How does FAQ visibility work?',
  'faq-visibility',
  'How category module gates control Help content.',
  $md$# How does FAQ visibility work?

FAQ categories can have a module gate.

## Public categories

Categories with no module gate are visible to all signed-in users. Examples include Getting Started and Troubleshooting.

## Module-gated categories

Categories with a module gate are only returned by the FAQ API when the current effective role can access that module.

This means direct API calls and the Help page both use the same permission boundary for restricted FAQ content.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'faq-editor',
  'How do I manage FAQ categories and articles?',
  'faq-editor-overview',
  'Using the FAQ editor to manage help content.',
  $md$# How do I manage FAQ categories and articles?

Users with FAQ Editor access can open **Admin -> FAQ Editor**.

## Categories

Use categories to group articles and assign a module gate when the content belongs to a restricted module.

## Articles

Use articles for the actual Help content. Keep titles task-focused, summaries short, and content current with the live app navigation.

When creating restricted content, place it in a category with the matching module gate.$md$,
  1
);

SELECT pg_temp.upsert_faq_article(
  'error-reports',
  'How do I manage error reports? (Admin)',
  'manage-error-reports',
  'Reviewing and resolving user-submitted error reports.',
  $md$# How do I manage error reports? (Admin)

Admins with Error Reports access can open the error reports management page.

## What to review

- Error title and description
- Related page or feature
- User and timestamp
- Current status

Update the status as the issue is investigated or resolved so the reporter can track progress from Help.$md$,
  0
);

SELECT pg_temp.upsert_faq_article(
  'notifications',
  'How do notifications work?',
  'notifications-overview',
  'Understanding notifications and message acknowledgements.',
  $md$# How do notifications work?

Notifications tell you when something needs attention.

## Common notification types

- Toolbox Talks that need a signature
- Reminders that need acknowledgement
- Project documents assigned for reading and signing
- Other app messages or alerts

## Notification badge

The badge on the navigation menu shows unread items. Open Notifications to read, acknowledge, or complete the required action.$md$,
  46
);

SELECT pg_temp.upsert_faq_article(
  'troubleshooting',
  'How do I report an error or suggest an improvement?',
  'help-support-tools',
  'Using the Help page support tools for errors and suggestions.',
  $md$# How do I report an error or suggest an improvement?

Open **Help** and use the support tabs.

## Report an error

Use the **Errors** tab to describe a bug or issue. Select the related page or feature and include steps to reproduce the problem.

## Suggest an improvement

Use the **Suggest** tab to send an idea for improving the app.

## Track your submissions

Use **My Suggestions** to track suggestion status. Error reports can be viewed in the Errors tab after loading your submitted reports.$md$,
  51
);

SELECT pg_temp.upsert_faq_article(
  'troubleshooting',
  'I am getting Access Denied - why?',
  'permission-denied',
  'Understanding module permission errors.',
  $md$# I am getting Access Denied - why?

Access Denied usually means your current effective role does not have permission for that module.

## Examples

Your role may not include access to modules such as Reports, Quotes, Inventory, Fleet, Admin Settings, FAQ Editor, or Error Reports.

## What to do

1. Check whether the feature should be available for your role.
2. Ask your manager or admin if you need access.
3. If an admin is testing with View As, switch back to the correct role before rechecking.

Help FAQ categories use the same module permissions, so restricted help content may also be hidden when you do not have access.$md$,
  50
);

UPDATE public.faq_categories
SET module_name = CASE slug
  WHEN 'getting-started' THEN NULL
  WHEN 'timesheets' THEN 'timesheets'
  WHEN 'inspections' THEN 'inspections'
  WHEN 'plant-daily-checks' THEN 'plant-inspections'
  WHEN 'hgv-daily-checks' THEN 'hgv-inspections'
  WHEN 'projects' THEN 'rams'
  WHEN 'absence' THEN 'absence'
  WHEN 'maintenance' THEN 'maintenance'
  WHEN 'fleet' THEN 'admin-vans'
  WHEN 'workshop-tasks' THEN 'workshop-tasks'
  WHEN 'approvals' THEN 'approvals'
  WHEN 'actions' THEN 'actions'
  WHEN 'toolbox-talks' THEN 'toolbox-talks'
  WHEN 'reports' THEN 'reports'
  WHEN 'customers' THEN 'customers'
  WHEN 'quotes' THEN 'quotes'
  WHEN 'inventory' THEN 'inventory'
  WHEN 'admin-users' THEN 'admin-users'
  WHEN 'admin-roles' THEN 'admin-users'
  WHEN 'admin-settings' THEN 'admin-settings'
  WHEN 'faq-editor' THEN 'faq-editor'
  WHEN 'error-reports' THEN 'error-reports'
  WHEN 'notifications' THEN NULL
  WHEN 'troubleshooting' THEN NULL
  ELSE module_name
END;

COMMENT ON COLUMN public.faq_categories.module_name IS
  'Optional ModuleName gate used by /api/faq to hide restricted help content from users without module access.';
