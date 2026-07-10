/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockingMessageModal } from '@/components/messages/BlockingMessageModal';

interface MockSignaturePadProps {
  onSave: (signature: string) => void;
  resetKey?: string;
  disabled?: boolean;
}

type DynamicModule =
  | { default?: ComponentType<Record<string, unknown>> }
  | ComponentType<Record<string, unknown>>;

vi.mock('next/dynamic', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: (loader: () => Promise<DynamicModule>) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Component, setComponent] = React.useState<ComponentType<Record<string, unknown>> | null>(null);

        React.useEffect(() => {
          let active = true;

          void Promise.resolve(loader()).then((loaded) => {
            const resolved = typeof loaded === 'function' ? loaded : loaded.default;
            if (active && resolved) {
              setComponent(() => resolved);
            }
          });

          return () => {
            active = false;
          };
        }, []);

        return Component ? React.createElement(Component, props) : null;
      };

      return DynamicComponent;
    },
  };
});

vi.mock('@/components/forms/SignaturePad', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    SignaturePad: ({ disabled = false, onSave, resetKey }: MockSignaturePadProps) => {
      const [signature, setSignature] = React.useState('');

      React.useEffect(() => {
        setSignature('');
      }, [resetKey]);

      return React.createElement(
        'div',
        { 'data-testid': 'signature-pad', 'data-reset-key': resetKey ?? '' },
        React.createElement('span', { 'data-testid': 'signature-state' }, signature || 'empty'),
        React.createElement(
          'button',
          {
            disabled,
            onClick: () => setSignature(`signed:${resetKey ?? 'global'}`),
            type: 'button',
          },
          'Draw signature',
        ),
        React.createElement(
          'button',
          {
            disabled,
            onClick: () => {
              if (signature) {
                onSave(signature);
              }
            },
            type: 'button',
          },
          'Save Signature',
        ),
      );
    },
  };
});

vi.mock('@/components/messages/ToolboxTalkPdfDialog', () => ({
  ToolboxTalkPdfDialog: () => null,
}));

type BlockingMessage = ComponentProps<typeof BlockingMessageModal>['message'];

function makeMessage(overrides: Partial<BlockingMessage> = {}): BlockingMessage {
  return {
    id: 'message-1',
    recipient_id: 'recipient-1',
    subject: 'Harness safety',
    body: 'Read this Toolbox Talk before continuing.',
    priority: 'HIGH',
    acceptance_delay_minutes: 0,
    first_shown_at: '2026-06-04T10:00:00.000Z',
    sender_name: 'Site Manager',
    created_at: '2026-06-04T09:00:00.000Z',
    pdf_file_path: null,
    ...overrides,
  };
}

function renderModal(message: BlockingMessage, onSigned = vi.fn()) {
  return render(
    <BlockingMessageModal
      open
      message={message}
      onSigned={onSigned}
      totalPending={2}
      currentIndex={0}
    />,
  );
}

describe('BlockingMessageModal', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        recipient: {
          first_shown_at: '2026-06-04T10:01:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('clears the signature pad when moving to the next pending message', async () => {
    const firstMessage = makeMessage();
    const secondMessage = makeMessage({
      id: 'message-2',
      recipient_id: 'recipient-2',
      subject: 'Ladder safety',
    });

    const { rerender } = renderModal(firstMessage);

    expect(await screen.findByTestId('signature-pad')).toHaveAttribute('data-reset-key', 'message-1:recipient-1');

    fireEvent.click(screen.getByRole('button', { name: 'Draw signature' }));
    expect(screen.getByTestId('signature-state')).toHaveTextContent('signed:message-1:recipient-1');

    rerender(
      <BlockingMessageModal
        open
        message={secondMessage}
        onSigned={vi.fn()}
        totalPending={2}
        currentIndex={1}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('signature-pad')).toHaveAttribute('data-reset-key', 'message-2:recipient-2');
      expect(screen.getByTestId('signature-state')).toHaveTextContent('empty');
    });
  });

  it('still submits the current message signature normally', async () => {
    const onSigned = vi.fn();

    renderModal(makeMessage(), onSigned);

    await screen.findByTestId('signature-pad');
    fireEvent.click(screen.getByRole('button', { name: 'Draw signature' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Signature' }));

    await waitFor(() => {
      expect(onSigned).toHaveBeenCalledTimes(1);
    });

    const signCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/sign'));
    expect(signCall).toBeDefined();

    const [url, init] = signCall as [string, RequestInit];
    expect(url).toBe('/api/messages/recipient-1/sign');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      signature_data: 'signed:message-1:recipient-1',
    });
  });
});
