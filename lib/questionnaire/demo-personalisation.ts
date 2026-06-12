export type QuestionnaireQuestionType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'url'
  | 'single_choice'
  | 'multi_choice';

export interface QuestionnaireOption {
  id: string;
  label: string;
}

export interface QuestionnaireQuestion {
  id: string;
  label: string;
  description?: string;
  type: QuestionnaireQuestionType;
  required?: boolean;
  placeholder?: string;
  options?: QuestionnaireOption[];
  maxSelections?: number;
}

export interface QuestionnaireSection {
  id: string;
  title: string;
  description: string;
  questions: QuestionnaireQuestion[];
}

export type QuestionnaireAnswerValue = string | string[];
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswerValue>;

export const questionnaireSections: QuestionnaireSection[] = [
  {
    id: 'company_brand',
    title: 'Company and brand',
    description: 'The basics we need to make the demo feel like it belongs to your business.',
    questions: [
      {
        id: 'contact_name',
        label: 'Your name',
        type: 'short_text',
        required: true,
        placeholder: 'Alex Morgan',
      },
      {
        id: 'contact_email',
        label: 'Your email address',
        type: 'email',
        required: true,
        placeholder: 'alex@example.com',
      },
      {
        id: 'contact_phone',
        label: 'Best phone number',
        type: 'phone',
        placeholder: 'Optional',
      },
      {
        id: 'company_name',
        label: 'Business name to use in the demo',
        type: 'short_text',
        required: true,
        placeholder: 'Example Civil Engineering Ltd',
      },
      {
        id: 'website_or_brand_assets',
        label: 'Website, logo, or brand asset link',
        description: 'A website URL is enough if you do not have a logo pack handy.',
        type: 'url',
        placeholder: 'https://example.com',
      },
      {
        id: 'app_name_preference',
        label: 'What should the demo app be called?',
        type: 'single_choice',
        required: true,
        options: [
          { id: 'keep_digidocs', label: 'Keep it as DigiDocs' },
          { id: 'company_docs', label: 'Use "<Company Name> Docs"' },
          { id: 'company_operations', label: 'Use "<Company Name> Operations"' },
          { id: 'not_sure', label: 'Not sure, choose something sensible' },
          { id: 'custom', label: 'I will add a custom name in the notes' },
        ],
      },
      {
        id: 'brand_colours',
        label: 'Brand colours to use',
        description: 'Hex codes are ideal, but plain colour names are fine.',
        type: 'short_text',
        placeholder: '#F1D64A, navy, white',
      },
    ],
  },
  {
    id: 'business_profile',
    title: 'Business profile',
    description: 'This shapes the terminology, examples, teams, and sample records.',
    questions: [
      {
        id: 'industry_sector',
        label: 'Which best describes your business?',
        type: 'single_choice',
        required: true,
        options: [
          { id: 'civil_engineering', label: 'Civil engineering or groundworks' },
          { id: 'utilities', label: 'Utilities or infrastructure' },
          { id: 'transport_logistics', label: 'Transport, logistics, or haulage' },
          { id: 'plant_hire', label: 'Plant hire or heavy equipment' },
          { id: 'facilities_maintenance', label: 'Facilities, maintenance, or service teams' },
          { id: 'other', label: 'Other' },
        ],
      },
      {
        id: 'company_size',
        label: 'Approximate team size',
        type: 'single_choice',
        required: true,
        options: [
          { id: 'under_25', label: 'Under 25 people' },
          { id: '25_75', label: '25 to 75 people' },
          { id: '76_150', label: '76 to 150 people' },
          { id: '151_300', label: '151 to 300 people' },
          { id: '300_plus', label: '300+ people' },
        ],
      },
      {
        id: 'operating_region',
        label: 'Where do you operate?',
        description: 'This helps make example projects and locations feel familiar.',
        type: 'short_text',
        placeholder: 'Norfolk, East Midlands, nationwide, etc.',
      },
    ],
  },
  {
    id: 'demo_priorities',
    title: 'Demo priorities',
    description: 'Pick the workflows that should get the most attention in the walkthrough.',
    questions: [
      {
        id: 'priority_modules',
        label: 'Which areas are most important to show?',
        description: 'Select up to 5.',
        type: 'multi_choice',
        required: true,
        maxSelections: 5,
        options: [
          { id: 'timesheets', label: 'Timesheets and approvals' },
          { id: 'daily_checks', label: 'Van, HGV, or plant daily checks' },
          { id: 'fleet_maintenance', label: 'Fleet, maintenance, and servicing' },
          { id: 'workshop', label: 'Workshop tasks and repairs' },
          { id: 'projects_rams', label: 'Projects, RAMS, and compliance documents' },
          { id: 'absence', label: 'Absence and holiday management' },
          { id: 'inventory', label: 'Inventory, tools, and equipment' },
          { id: 'quotes_customers', label: 'Quotes and customer records' },
          { id: 'reports', label: 'Reports and management visibility' },
          { id: 'integrations', label: 'Maps, DVLA/MOT, or fleet integrations' },
        ],
      },
      {
        id: 'primary_demo_objective',
        label: 'What should the demo prove most clearly?',
        type: 'single_choice',
        required: true,
        options: [
          { id: 'save_admin_time', label: 'It will save office/admin time' },
          { id: 'improve_compliance', label: 'It will improve compliance and audit trails' },
          { id: 'replace_paper', label: 'It can replace paper forms and spreadsheets' },
          { id: 'manager_visibility', label: 'Managers get better live visibility' },
          { id: 'field_usability', label: 'Field teams will actually use it' },
          { id: 'customer_outputs', label: 'Customer-facing documents look professional' },
        ],
      },
      {
        id: 'biggest_pain_points',
        label: 'What problems should the demo reflect?',
        description: 'Select any that apply.',
        type: 'multi_choice',
        options: [
          { id: 'paper_forms', label: 'Paper forms are slow or go missing' },
          { id: 'spreadsheet_duplication', label: 'Too much duplicate spreadsheet work' },
          { id: 'late_timesheets', label: 'Late or inaccurate timesheets' },
          { id: 'missed_defects', label: 'Vehicle or plant defects are hard to track' },
          { id: 'document_control', label: 'RAMS, toolbox talks, or documents are hard to control' },
          { id: 'absence_visibility', label: 'Absence planning is unclear' },
          { id: 'reporting', label: 'Reporting takes too long' },
          { id: 'other', label: 'Other, explained in the notes' },
        ],
      },
    ],
  },
  {
    id: 'people_operations',
    title: 'People and operations',
    description: 'These answers shape the demo teams, user roles, and example data.',
    questions: [
      {
        id: 'teams_to_reflect',
        label: 'Which teams should appear in the demo?',
        type: 'multi_choice',
        options: [
          { id: 'management', label: 'Management' },
          { id: 'office_admin', label: 'Office/admin' },
          { id: 'accounts', label: 'Accounts' },
          { id: 'civils_site', label: 'Civils/site teams' },
          { id: 'transport', label: 'Transport' },
          { id: 'plant', label: 'Plant' },
          { id: 'workshop', label: 'Workshop' },
          { id: 'contractors', label: 'Subcontractors or external users' },
        ],
      },
      {
        id: 'roles_to_show',
        label: 'Which demo login roles matter most?',
        type: 'multi_choice',
        required: true,
        options: [
          { id: 'director_admin', label: 'Director or system admin' },
          { id: 'manager_supervisor', label: 'Manager or supervisor' },
          { id: 'office_user', label: 'Office user' },
          { id: 'driver_operator', label: 'Driver, operative, or engineer' },
          { id: 'contractor', label: 'Contractor or limited-access user' },
        ],
      },
      {
        id: 'asset_mix',
        label: 'Which assets should be represented?',
        type: 'multi_choice',
        options: [
          { id: 'vans', label: 'Vans or light commercial vehicles' },
          { id: 'hgvs', label: 'HGVs or trailers' },
          { id: 'plant', label: 'Plant and heavy machinery' },
          { id: 'small_tools', label: 'Small tools and equipment' },
          { id: 'no_assets', label: 'Assets are not important for this demo' },
        ],
      },
      {
        id: 'asset_scale',
        label: 'Approximate fleet or asset scale',
        type: 'single_choice',
        options: [
          { id: 'none', label: 'Not relevant' },
          { id: 'under_10', label: 'Under 10 assets' },
          { id: '10_50', label: '10 to 50 assets' },
          { id: '51_150', label: '51 to 150 assets' },
          { id: '150_plus', label: '150+ assets' },
        ],
      },
    ],
  },
  {
    id: 'demo_content',
    title: 'Demo content',
    description: 'A few real-world examples make the demo feel much more relevant.',
    questions: [
      {
        id: 'example_work',
        label: 'Example project, job, customer, or site names we can mirror',
        description: 'Use fictionalised names if preferred.',
        type: 'long_text',
        placeholder: 'Example: A47 resurfacing, depot maintenance, drainage works, ABC Utilities...',
      },
      {
        id: 'document_outputs',
        label: 'Which outputs should look personalised?',
        type: 'multi_choice',
        options: [
          { id: 'pdf_timesheets', label: 'Timesheet PDFs' },
          { id: 'inspection_pdfs', label: 'Inspection or defect PDFs' },
          { id: 'rams_documents', label: 'RAMS or project documents' },
          { id: 'quote_pdfs', label: 'Quote PDFs' },
          { id: 'emails', label: 'Email notifications' },
          { id: 'pwa_install', label: 'App icon/install screen' },
        ],
      },
      {
        id: 'demo_logistics',
        label: 'Who will attend the demo, and is there anything specific they care about?',
        description: 'Include any timing, audience, or sensitivity notes.',
        type: 'long_text',
        placeholder: 'Example: Operations director and transport manager; focus on daily checks and reporting.',
      },
    ],
  },
];

export const questionnaireQuestionMap = new Map(
  questionnaireSections.flatMap((section) => section.questions.map((question) => [question.id, question]))
);

export function getQuestionnaireQuestion(questionId: string): QuestionnaireQuestion | undefined {
  return questionnaireQuestionMap.get(questionId);
}

export function getQuestionOptionLabel(question: QuestionnaireQuestion, optionId: string): string {
  return question.options?.find((option) => option.id === optionId)?.label ?? optionId;
}
