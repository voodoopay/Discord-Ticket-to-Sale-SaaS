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

  it('refuses in low reply frequency when retrieved evidence is weak', async () => {
    const retrieveEvidence = vi.fn().mockResolvedValue([
      {
        sourceType: 'website_document',
        sourceId: 'source-1',
        content: 'General shipping information.',
        title: 'Shipping',
        url: 'https://example.com/shipping',
        question: null,
        answer: null,
        channelId: null,
        messageId: null,
        score: 1,
      },
    ]);
    const generateGroundedResponse = vi.fn();
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
      toneInstructions: '',
      replyFrequency: 'low',
    });

    expect(generateGroundedResponse).not.toHaveBeenCalled();
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

  it('answers in max reply frequency when any approved evidence exists', async () => {
    const retrieveEvidence = vi.fn().mockResolvedValue([
      {
        sourceType: 'website_document',
        sourceId: 'source-1',
        content: 'General shipping information.',
        title: 'Shipping',
        url: 'https://example.com/shipping',
        question: null,
        answer: null,
        channelId: null,
        messageId: null,
        score: 1,
      },
    ]);
    const generateGroundedResponse = vi.fn().mockResolvedValue({
      outputText: 'Shipping details are available on the approved shipping page.',
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
      question: 'How does shipping work?',
      tonePreset: 'standard',
      toneInstructions: '',
      replyFrequency: 'max',
    });

    expect(generateGroundedResponse).toHaveBeenCalledOnce();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }
    expect(result.value).toMatchObject({
      kind: 'answer',
      content: 'Shipping details are available on the approved shipping page.',
      evidenceCount: 1,
    });
  });
});
