import { describe, expect, it, vi } from 'vitest';

import { AiAnswerService } from '../src/services/ai-answer-service.js';

describe('AiAnswerService', () => {
  it('refuses when no grounded evidence is available', async () => {
    const service = new AiAnswerService(
      {
        retrieveEvidence: vi.fn().mockResolvedValue([]),
      },
      {
        generateGroundedResponse: vi.fn(),
      },
    );

    const result = await service.answerMessage({
      guildId: 'guild-1',
      question: 'What is the refund policy?',
      tonePreset: 'professional',
      toneInstructions: '',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      kind: 'refusal',
      content: 'I do not have enough approved information to answer that yet.',
      evidenceCount: 0,
    });
  });

  it('generates a grounded answer when evidence exists', async () => {
    const retrieveEvidence = vi.fn().mockResolvedValue([
      {
        sourceType: 'website_document',
        sourceId: 'source-1',
        content: 'Refunds are accepted within fourteen days of purchase.',
        title: 'Refunds',
        url: 'https://example.com/refunds',
        question: null,
        answer: null,
        score: 7,
      },
    ]);
    const generateGroundedResponse = vi.fn().mockResolvedValue({
      outputText: 'Refunds are accepted within fourteen days of purchase.',
      requestId: 'req_123',
      model: 'gpt-4o-mini',
    });
    const service = new AiAnswerService(
      {
        retrieveEvidence,
      },
      {
        generateGroundedResponse,
      },
    );

    const result = await service.answerMessage({
      guildId: 'guild-1',
      question: 'What is the refund policy?',
      tonePreset: 'professional',
      toneInstructions: 'Keep it concise.',
    });

    expect(retrieveEvidence).toHaveBeenCalledWith({
      guildId: 'guild-1',
      question: 'What is the refund policy?',
    });
    expect(generateGroundedResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'What is the refund policy?',
        instructions: expect.stringContaining('Refunds are accepted within fourteen days of purchase.'),
      }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toMatchObject({
      kind: 'answer',
      content: 'Refunds are accepted within fourteen days of purchase.',
      evidenceCount: 1,
      evidence: [
        {
          sourceType: 'website_document',
          sourceId: 'source-1',
          title: 'Refunds',
          url: 'https://example.com/refunds',
          question: null,
        },
      ],
    });
  });
});
