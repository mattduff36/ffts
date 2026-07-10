import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { AttachmentHybridFormModal } from '@/components/workshop-tasks/AttachmentHybridFormModal';
import type { AttachmentSchemaResponse, AttachmentSchemaSnapshot } from '@/types/workshop-attachments-v2';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'attachment-hybrid-test-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: ComponentProps<'img'>) => <img {...props} alt={props.alt || 'image'} />,
}));

vi.mock('@/components/forms/SignaturePad', () => ({
  SignaturePad: ({ onSave }: { onSave: (signature: string) => void }) => (
    <button type="button" onClick={() => onSave('data:image/png;base64,abc')}>
      Mock Save Signature
    </button>
  ),
}));

const snapshot: AttachmentSchemaSnapshot = {
  id: 'snapshot-1',
  attachment_id: 'attachment-1',
  template_version_id: 'version-1',
  snapshot_json: {
    template_id: 'template-1',
    version_id: 'version-1',
    generated_at: '2026-04-01T12:00:00.000Z',
    sections: [
      {
        id: 'section-a',
        section_key: 'inside_cab',
        title: 'Inside Cab',
        description: null,
        sort_order: 1,
        fields: [
          {
            id: 'field-a1',
            field_key: 'engine_mil',
            label: 'Engine MIL',
            help_text: null,
            field_type: 'marking_code',
            is_required: true,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
      {
        id: 'section-b',
        section_key: 'declaration',
        title: 'Declaration',
        description: null,
        sort_order: 2,
        fields: [
          {
            id: 'field-b1',
            field_key: 'inspector_name',
            label: 'Inspector Name',
            help_text: null,
            field_type: 'text',
            is_required: true,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
    ],
  },
};

const signatureSnapshot: AttachmentSchemaSnapshot = {
  id: 'snapshot-2',
  attachment_id: 'attachment-2',
  template_version_id: 'version-2',
  snapshot_json: {
    template_id: 'template-2',
    version_id: 'version-2',
    generated_at: '2026-04-01T12:00:00.000Z',
    sections: [
      {
        id: 'section-signature',
        section_key: 'declaration',
        title: 'Declaration',
        description: null,
        sort_order: 1,
        fields: [
          {
            id: 'field-signature',
            field_key: 'inspector_signature',
            label: 'Inspector Signature',
            help_text: null,
            field_type: 'signature',
            is_required: false,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
    ],
  },
};

const noteSnapshot: AttachmentSchemaSnapshot = {
  id: 'snapshot-3',
  attachment_id: 'attachment-3',
  template_version_id: 'version-3',
  snapshot_json: {
    template_id: 'template-3',
    version_id: 'version-3',
    generated_at: '2026-04-01T12:00:00.000Z',
    sections: [
      {
        id: 'section-note',
        section_key: 'wheels',
        title: 'Wheels',
        description: null,
        sort_order: 1,
        fields: [
          {
            id: 'field-note',
            field_key: 'check_tyres',
            label: 'Check tyres',
            help_text: null,
            field_type: 'marking_code',
            is_required: true,
            sort_order: 1,
            options_json: null,
            validation_json: { require_note_for: ['attention'] },
          },
        ],
      },
    ],
  },
};

const existingInspectionResponses: AttachmentSchemaResponse[] = [
  {
    section_key: 'inside_cab',
    field_key: 'engine_mil',
    field_id: 'field-a1',
    response_value: 'serviceable',
    response_json: null,
  },
  {
    section_key: 'declaration',
    field_key: 'inspector_name',
    field_id: 'field-b1',
    response_value: 'A. Inspector',
    response_json: null,
  },
];

interface RenderInspectionModalOptions {
  initialActiveSectionKey?: string;
  initialScrollTop?: number;
  onActiveSectionChange?: (sectionKey: string) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  onOpenChange?: (open: boolean) => void;
  onSave?: (responses: AttachmentSchemaResponse[], markComplete: boolean) => Promise<void>;
}

function renderInspectionModal(
  existingResponses: AttachmentSchemaResponse[],
  options: RenderInspectionModalOptions = {},
) {
  return (
    <TabletModeProvider>
      <AttachmentHybridFormModal
        open
        onOpenChange={options.onOpenChange || vi.fn()}
        templateName="6 Week Inspection - HGV"
        snapshot={snapshot}
        existingResponses={existingResponses}
        attachmentId="attachment-refresh"
        initialActiveSectionKey={options.initialActiveSectionKey}
        initialScrollTop={options.initialScrollTop}
        onActiveSectionChange={options.onActiveSectionChange}
        onScrollPositionChange={options.onScrollPositionChange}
        onSave={options.onSave || vi.fn(async () => undefined)}
      />
    </TabletModeProvider>
  );
}

function ReopenInspectionModalHarness() {
  const [open, setOpen] = useState(true);
  const [activeSectionKey, setActiveSectionKey] = useState<string | undefined>();
  const [scrollTop, setScrollTop] = useState(0);

  return (
    <TabletModeProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Open attachment
      </button>
      {open && (
        <AttachmentHybridFormModal
          open
          onOpenChange={setOpen}
          templateName="6 Week Inspection - HGV"
          snapshot={snapshot}
          existingResponses={existingInspectionResponses}
          attachmentId="attachment-refresh"
          initialActiveSectionKey={activeSectionKey}
          initialScrollTop={scrollTop}
          onActiveSectionChange={setActiveSectionKey}
          onScrollPositionChange={setScrollTop}
          onSave={vi.fn(async () => undefined)}
        />
      )}
    </TabletModeProvider>
  );
}

describe('AttachmentHybridFormModal', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tablet_mode:attachment-hybrid-test-user', 'on');
  });

  it('renders sections and saves completed payload', async () => {
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => undefined);
    const onOpenChange = vi.fn();

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={onOpenChange}
          templateName="6 Week Inspection - HGV"
          snapshot={snapshot}
          existingResponses={[
            {
              section_key: 'inside_cab',
              field_key: 'engine_mil',
              field_id: 'field-a1',
              response_value: 'serviceable',
              response_json: null,
            },
            {
              section_key: 'declaration',
              field_key: 'inspector_name',
              field_id: 'field-b1',
              response_value: 'A. Inspector',
              response_json: null,
            },
          ]}
          onSave={onSave}
        />
      </TabletModeProvider>,
    );

    expect(screen.getAllByText('Inside Cab').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Declaration').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Attachment' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0][1]).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('persists signer name in response_json without existing signature payload', async () => {
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => undefined);

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={vi.fn()}
          templateName="Signature Test"
          snapshot={signatureSnapshot}
          existingResponses={[]}
          onSave={onSave}
        />
      </TabletModeProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Signer name'), { target: { value: 'J. Inspector' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const payload = onSave.mock.calls[0][0] as Array<{
      field_key: string;
      response_json: Record<string, unknown> | null;
    }>;
    const signatureResponse = payload.find((entry) => entry.field_key === 'inspector_signature');

    expect(signatureResponse).toBeDefined();
    expect(signatureResponse?.response_json).toMatchObject({ signed_by_name: 'J. Inspector' });
  });

  it('preserves spaces while typing attention notes', async () => {
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => undefined);

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={vi.fn()}
          templateName="Note Test"
          snapshot={noteSnapshot}
          existingResponses={[]}
          onSave={onSave}
        />
      </TabletModeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));

    const noteInput = await screen.findByRole('textbox', { name: /notes/i }) as HTMLTextAreaElement;
    fireEvent.change(noteInput, { target: { value: 'all ' } });
    expect(noteInput.value).toBe('all ');

    fireEvent.change(noteInput, { target: { value: 'all four tyres' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const payload = onSave.mock.calls[0][0] as Array<{
      field_key: string;
      response_json: Record<string, unknown> | null;
    }>;
    const noteResponse = payload.find((entry) => entry.field_key === 'check_tyres');

    expect(noteResponse).toBeDefined();
    expect(noteResponse?.response_json).toMatchObject({ note: 'all four tyres' });
  });

  it('keeps the active section when existing responses refresh while open', async () => {
    const { rerender } = render(renderInspectionModal(existingInspectionResponses));

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    expect(screen.getByRole('textbox', { name: /inspector name/i })).toBeInTheDocument();

    rerender(renderInspectionModal([
      ...existingInspectionResponses,
      {
        section_key: 'inside_cab',
        field_key: 'engine_mil',
        field_id: 'field-a1',
        response_value: 'serviceable',
        response_json: { refreshed_at: '2026-04-01T12:01:00.000Z' },
      },
    ]));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /inspector name/i })).toBeInTheDocument();
    });
  });

  it('does not clobber unsaved input when existing responses refresh while open', async () => {
    const { rerender } = render(renderInspectionModal(existingInspectionResponses));

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    const inspectorInput = screen.getByRole('textbox', { name: /inspector name/i }) as HTMLInputElement;
    fireEvent.change(inspectorInput, { target: { value: 'Unsaved Inspector' } });

    rerender(renderInspectionModal([
      existingInspectionResponses[0],
      {
        section_key: 'declaration',
        field_key: 'inspector_name',
        field_id: 'field-b1',
        response_value: 'Server Inspector',
        response_json: null,
      },
    ]));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /inspector name/i })).toHaveValue('Unsaved Inspector');
    });
  });

  it('saves dirty drafts before dismissing the modal', async () => {
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => undefined);
    const onOpenChange = vi.fn();
    render(renderInspectionModal(existingInspectionResponses, { onSave, onOpenChange }));

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /inspector name/i }), {
      target: { value: 'Dismissed Inspector' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0][1]).toBe(false);
    expect(onSave.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section_key: 'declaration',
        field_key: 'inspector_name',
        response_value: 'Dismissed Inspector',
      }),
    ]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps dirty modal open when dismissal save fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => {
      throw new Error('Save failed');
    });
    const onOpenChange = vi.fn();

    render(renderInspectionModal(existingInspectionResponses, { onSave, onOpenChange }));

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /inspector name/i }), {
      target: { value: 'Still Open Inspector' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('textbox', { name: /inspector name/i })).toHaveValue('Still Open Inspector');

    consoleErrorSpy.mockRestore();
  });

  it('explicit discard closes dirty modal without saving', () => {
    const onSave = vi.fn(async (_responses: AttachmentSchemaResponse[], _markComplete: boolean) => undefined);
    const onOpenChange = vi.fn();
    render(renderInspectionModal(existingInspectionResponses, { onSave, onOpenChange }));

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /inspector name/i }), {
      target: { value: 'Discarded Inspector' },
    });
    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reopens to the previous active section after dismissal', async () => {
    render(<ReopenInspectionModalHarness />);

    fireEvent.click(screen.getByRole('button', { name: /declaration/i }));
    expect(screen.getByRole('textbox', { name: /inspector name/i })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: /inspector name/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /open attachment/i }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /inspector name/i })).toBeInTheDocument();
    });
  });

  it('reopens to the previous scroll position after dismissal', async () => {
    render(<ReopenInspectionModalHarness />);

    const scrollArea = screen.getByTestId('attachment-form-scroll-area');
    scrollArea.scrollTop = 420;
    fireEvent.scroll(scrollArea);

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => {
      expect(screen.queryByTestId('attachment-form-scroll-area')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /open attachment/i }));
    await waitFor(() => {
      expect(screen.getByTestId('attachment-form-scroll-area').scrollTop).toBe(420);
    });
  });

  it('restores a locally saved attachment draft on reopen', async () => {
    const originalIndexedDb = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      value: undefined,
      configurable: true,
    });

    const updatedAt = Date.now();
    localStorage.setItem('avs_workshop_task_draft:workshop-attachment:attachment-restore', JSON.stringify({
      id: 'workshop-attachment:attachment-restore',
      ownerId: null,
      route: '/workshop-tasks?taskId=task-1',
      kind: 'workshop-attachment',
      encrypted: false,
      iv: null,
      updatedAt,
      expiresAt: updatedAt + 60_000,
      payload: JSON.stringify({
        responses: {
          'inside_cab::engine_mil': {
            response_value: 'attention',
            response_json: null,
            field_id: 'field-a1',
          },
        },
        signatureNames: {},
        activeSectionKey: 'inside_cab',
      }),
    }));

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={vi.fn()}
          templateName="6 Week Inspection - HGV"
          snapshot={snapshot}
          existingResponses={[]}
          attachmentId="attachment-restore"
          onSave={vi.fn(async () => undefined)}
        />
      </TabletModeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'true');
    });

    Object.defineProperty(window, 'indexedDB', {
      value: originalIndexedDb,
      configurable: true,
    });
  });
});
