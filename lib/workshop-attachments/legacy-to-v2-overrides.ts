export interface LegacyTemplateSectionRule {
  section_key: string;
  title: string;
  description: string;
  keyword_hints: string[];
}

interface LegacyTemplateSectionPreset {
  template_name_hints: string[];
  section_rules: LegacyTemplateSectionRule[];
}

const DEFAULT_SECTION_RULES: LegacyTemplateSectionRule[] = [
  {
    section_key: 'service_items',
    title: 'Service Items',
    description: 'Routine service and replacement items.',
    keyword_hints: ['service', 'filter', 'oil', 'fluid', 'coolant', 'ad blue', 'reagent', 'grease'],
  },
  {
    section_key: 'mechanical_condition',
    title: 'Mechanical Condition',
    description: 'Mechanical checks and working condition.',
    keyword_hints: ['engine', 'gearbox', 'transmission', 'brake', 'steering', 'suspension', 'clutch', 'hydraulic'],
  },
  {
    section_key: 'wheels_tyres',
    title: 'Wheels and Tyres',
    description: 'Tyre, wheel, and wheel-fixing checks.',
    keyword_hints: ['tyre', 'tire', 'wheel', 'rim', 'nut', 'stud', 'tread'],
  },
  {
    section_key: 'electrical_lighting',
    title: 'Electrical and Lighting',
    description: 'Electrical systems, lights, and warning indicators.',
    keyword_hints: ['light', 'indicator', 'electrical', 'battery', 'wiper', 'washer', 'horn', 'beacon'],
  },
  {
    section_key: 'structure_safety',
    title: 'Structure and Safety',
    description: 'Bodywork, safety equipment, and compliance checks.',
    keyword_hints: ['body', 'chassis', 'frame', 'cab', 'door', 'mirror', 'glass', 'safety', 'guard', 'alarm'],
  },
  {
    section_key: 'documentation_signoff',
    title: 'Documentation and Sign-Off',
    description: 'Records, notes, and completion sign-off details.',
    keyword_hints: ['document', 'certificate', 'dft', 'plate', 'report', 'sign', 'signature', 'date'],
  },
];

const TEMPLATE_PRESETS: LegacyTemplateSectionPreset[] = [
  {
    template_name_hints: ['van service', 'vehicle van'],
    section_rules: [
      {
        section_key: 'engine_service',
        title: 'Engine and Fluids',
        description: 'Engine servicing, fluid levels, and filter changes.',
        keyword_hints: ['engine', 'oil', 'coolant', 'filter', 'fuel', 'ad blue', 'reagent', 'belt'],
      },
      {
        section_key: 'drivetrain_brakes',
        title: 'Drivetrain and Brakes',
        description: 'Transmission, braking, and steering checks.',
        keyword_hints: ['gearbox', 'transmission', 'clutch', 'brake', 'steering', 'suspension'],
      },
      {
        section_key: 'wheels_tyres',
        title: 'Wheels and Tyres',
        description: 'Tyre condition, pressures, and wheel security.',
        keyword_hints: ['tyre', 'tire', 'wheel', 'rim', 'nut', 'stud', 'tread'],
      },
      {
        section_key: 'electrical_body',
        title: 'Electrical and Body',
        description: 'Lighting, electrical, and bodywork checks.',
        keyword_hints: ['light', 'indicator', 'battery', 'wiper', 'horn', 'mirror', 'door', 'body'],
      },
      {
        section_key: 'documentation_signoff',
        title: 'Documentation and Sign-Off',
        description: 'Final notes, records, and sign-off details.',
        keyword_hints: ['document', 'service record', 'signature', 'sign', 'date', 'dft', 'plate'],
      },
    ],
  },
  {
    template_name_hints: ['plant service', 'inspection', 'plant'],
    section_rules: [
      {
        section_key: 'powertrain_hydraulics',
        title: 'Powertrain and Hydraulics',
        description: 'Engine, drivetrain, and hydraulic system checks.',
        keyword_hints: ['engine', 'hydraulic', 'gearbox', 'oil', 'coolant', 'filter', 'belt'],
      },
      {
        section_key: 'safety_controls',
        title: 'Safety and Controls',
        description: 'Operator controls and machine safety features.',
        keyword_hints: ['safety', 'guard', 'alarm', 'emergency', 'switch', 'control', 'cab', 'seat', 'belt'],
      },
      {
        section_key: 'undercarriage_structure',
        title: 'Undercarriage and Structure',
        description: 'Structure, frame, body, and movement components.',
        keyword_hints: ['track', 'wheel', 'tyre', 'chassis', 'frame', 'boom', 'arm', 'bucket', 'pin', 'bush'],
      },
      {
        section_key: 'electrical_lighting',
        title: 'Electrical and Lighting',
        description: 'Electrical functionality and all lights.',
        keyword_hints: ['light', 'indicator', 'electrical', 'battery', 'wiper', 'horn', 'beacon'],
      },
      {
        section_key: 'documentation_signoff',
        title: 'Documentation and Sign-Off',
        description: 'Compliance records, notes, and sign-off.',
        keyword_hints: ['certificate', 'document', 'loler', 'report', 'sign', 'signature', 'date'],
      },
    ],
  },
  {
    template_name_hints: ['loler'],
    section_rules: [
      {
        section_key: 'lifting_components',
        title: 'Lifting Components',
        description: 'Lifting points, moving joints, and structural lifting parts.',
        keyword_hints: ['lifting', 'hook', 'eye', 'pin', 'bush', 'chain', 'boom', 'slew'],
      },
      {
        section_key: 'labels_certification',
        title: 'Labels and Certification',
        description: 'Inspection labels, charts, and certification details.',
        keyword_hints: ['chart', 'sticker', 'certificate', 'plate', 'label', 'report'],
      },
      {
        section_key: 'function_safety',
        title: 'Function and Safety',
        description: 'Operational safety and functional checks.',
        keyword_hints: ['safety', 'alarm', 'guard', 'lock', 'emergency', 'operation'],
      },
      {
        section_key: 'notes_signoff',
        title: 'Notes and Sign-Off',
        description: 'Defect notes and sign-off details.',
        keyword_hints: ['comment', 'note', 'sign', 'signature', 'date'],
      },
    ],
  },
  {
    template_name_hints: ['6wi', '6 week', 'hgv', 'trailer', 'unit'],
    section_rules: [
      {
        section_key: 'documentation_compliance',
        title: 'Documentation and Compliance',
        description: 'Legal plates, records, and compliance items.',
        keyword_hints: ['dft', 'plate', 'certificate', 'report', 'documentation', 'tacho'],
      },
      {
        section_key: 'cab_controls',
        title: 'Cab and Controls',
        description: 'In-cab controls and driver environment checks.',
        keyword_hints: ['cab', 'seat', 'belt', 'dashboard', 'wiper', 'washer', 'mirror', 'horn', 'heater'],
      },
      {
        section_key: 'powertrain_braking',
        title: 'Powertrain and Braking',
        description: 'Engine, drivetrain, and braking checks.',
        keyword_hints: ['engine', 'gearbox', 'transmission', 'brake', 'clutch', 'steering', 'suspension', 'ad blue'],
      },
      {
        section_key: 'chassis_running_gear',
        title: 'Chassis and Running Gear',
        description: 'Wheels, tyres, suspension, and body/chassis components.',
        keyword_hints: ['wheel', 'tyre', 'tread', 'chassis', 'frame', 'axle', 'fifth wheel', 'coupling'],
      },
      {
        section_key: 'lighting_signals',
        title: 'Lighting and Signals',
        description: 'All lighting, indicators, and warning systems.',
        keyword_hints: ['light', 'indicator', 'marker', 'lamp', 'beacon', 'warning'],
      },
      {
        section_key: 'defects_signoff',
        title: 'Defects and Sign-Off',
        description: 'Defect notes, rectification details, and sign-off.',
        keyword_hints: ['defect', 'rectification', 'comment', 'note', 'sign', 'signature', 'date'],
      },
    ],
  },
];

function normalizeTemplateName(value: string): string {
  return value.trim().toLowerCase();
}

export function getLegacyTemplateSectionRules(templateName: string): LegacyTemplateSectionRule[] {
  const normalizedTemplateName = normalizeTemplateName(templateName);
  const preset = TEMPLATE_PRESETS.find((entry) => (
    entry.template_name_hints.some((hint) => normalizedTemplateName.includes(hint))
  ));
  return preset ? preset.section_rules : DEFAULT_SECTION_RULES;
}
