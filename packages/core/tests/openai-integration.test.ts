import { afterEach, describe, expect, it, vi } from 'vitest';

const createResponseSpy = vi.fn();
const openAiConstructorSpy = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public readonly responses = {
      create: createResponseSpy,
    };

    constructor(config: { apiKey: string }) {
      openAiConstructorSpy(config);
    }
  },
}));

describe('openai integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the responses api and returns output_text', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';

    const { resetEnvForTests } = await import('../src/config/env.js');
    resetEnvForTests();

    createResponseSpy.mockResolvedValue({
      output_text: 'Grounded answer.',
      _request_id: 'req_123',
    });

    const { generateGroundedResponse } = await import('../src/integrations/openai.js');
    const response = await generateGroundedResponse({
      instructions: 'Use approved evidence only.',
      question: 'What is the refund policy?',
    });

    expect(openAiConstructorSpy).toHaveBeenCalledWith({ apiKey: 'sk-test-key' });
    expect(createResponseSpy).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      instructions: 'Use approved evidence only.',
      input: 'What is the refund policy?',
    });
    expect(response).toEqual({
      outputText: 'Grounded answer.',
      requestId: 'req_123',
      model: 'gpt-4o-mini',
    });
  });
});
