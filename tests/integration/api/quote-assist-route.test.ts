import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockRequireSensitiveModuleAccess,
  mockGenerateText,
  mockCreateOpenAI,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireSensitiveModuleAccess: vi.fn(),
  mockGenerateText: vi.fn(),
  mockCreateOpenAI: vi.fn(() => vi.fn((model: string) => ({ provider: 'openai', model }))),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveModuleAccess,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  Output: {
    object: vi.fn((config: unknown) => config),
  },
}));

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/quotes/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/quotes/assist', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('QUOTE_OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('QUOTE_AI_PROVIDER', 'openai');
    vi.stubEnv('QUOTE_AI_MODEL', 'gpt-4.1-nano');
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
    mockRequireSensitiveModuleAccess.mockResolvedValue(null);
    mockGenerateText.mockResolvedValue({
      output: {
        subject_line: 'Installation of signage posts - Middlebeck Way',
        project_description: 'Install six sets of signage posts along Middlebeck Way.',
        scope: '- Mobilise two operatives and HIAB vehicle.\n- Excavate and install post sleeves.',
        caveats: ['Confirm final positions.'],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a structured quote draft from a customer email', async () => {
    const { POST } = await import('@/app/api/quotes/assist/route');

    const response = await POST(createPostRequest({
      customerEmail: 'Would you be able to quote me for installing six sets of posts along Middlebeck Way?',
      customerName: 'Kingfisher Signs',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: 'test-openai-key',
      baseURL: 'https://api.openai.com/v1',
    });
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'openai', model: 'gpt-4.1-nano' },
      prompt: expect.stringContaining('Kingfisher Signs'),
    }));
    expect(payload).toEqual({
      subject_line: 'Installation of signage posts - Middlebeck Way',
      project_description: 'Install six sets of signage posts along Middlebeck Way.',
      scope: '- Mobilise two operatives and HIAB vehicle.\n- Excavate and install post sleeves.',
      caveats: ['Confirm final positions.'],
    });
  });

  it('rejects an empty customer email before calling the provider', async () => {
    const { POST } = await import('@/app/api/quotes/assist/route');

    const response = await POST(createPostRequest({ customerEmail: '' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Paste the customer email');
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns a configuration error when OpenAI is not configured', async () => {
    vi.stubEnv('QUOTE_OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const { POST } = await import('@/app/api/quotes/assist/route');

    const response = await POST(createPostRequest({
      customerEmail: 'Please quote for installing signage posts along Middlebeck Way with positions to be confirmed.',
    }));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe('Quote AI assist is not configured yet.');
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('prefers the quote-specific OpenAI key over the global OpenAI key', async () => {
    vi.stubEnv('QUOTE_OPENAI_API_KEY', 'quote-specific-key');
    vi.stubEnv('OPENAI_API_KEY', 'local');
    const { POST } = await import('@/app/api/quotes/assist/route');

    const response = await POST(createPostRequest({
      customerEmail: 'Please quote for installing signage posts along Middlebeck Way with positions to be confirmed.',
    }));

    expect(response.status).toBe(200);
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: 'quote-specific-key',
      baseURL: 'https://api.openai.com/v1',
    });
  });
});
