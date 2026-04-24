import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import {
  generateGroundedResponse,
  type GenerateGroundedResponseInput,
  type GenerateGroundedResponseOutput,
} from '../integrations/openai.js';
import {
  AiKnowledgeRepository,
  type AiRetrievedEvidence,
} from '../repositories/ai-knowledge-repository.js';
import type { AiReplyFrequency, AiTonePreset } from '../repositories/ai-config-repository.js';

const GROUNDED_REFUSAL_MESSAGE = 'I do not have enough approved information to answer that yet.';

export type AiAnswerEvidenceSummary = {
  sourceType: AiRetrievedEvidence['sourceType'];
  sourceId: string;
  title: string | null;
  url: string | null;
  question: string | null;
  channelId: string | null;
  messageId: string | null;
};

export type AiAnswerResult =
  | {
      kind: 'refusal';
      content: string;
      evidenceCount: 0;
    }
  | {
      kind: 'answer';
      content: string;
      evidenceCount: number;
      evidence: AiAnswerEvidenceSummary[];
    };

export type AiAnswerRepositoryLike = Pick<AiKnowledgeRepository, 'retrieveEvidence'>;

export type AiGroundedResponder = {
  generateGroundedResponse(
    input: GenerateGroundedResponseInput,
  ): Promise<GenerateGroundedResponseOutput>;
};

function formatEvidence(evidence: AiRetrievedEvidence[]): string {
  return evidence
    .map((item, index) => {
      if (item.sourceType === 'custom_qa') {
        return [
          `Evidence ${index + 1} [Approved Q&A]`,
          `Question: ${item.question ?? ''}`,
          `Answer: ${item.answer ?? ''}`,
        ]
          .filter(Boolean)
          .join('\n');
      }

      if (item.sourceType === 'discord_channel_message') {
        return [
          `Evidence ${index + 1} [Discord channel]`,
          item.channelId ? `Channel ID: ${item.channelId}` : null,
          item.messageId ? `Message ID: ${item.messageId}` : null,
          item.content,
        ]
          .filter(Boolean)
          .join('\n');
      }

      return [
        `Evidence ${index + 1} [Website]`,
        item.title ? `Title: ${item.title}` : null,
        item.url ? `URL: ${item.url}` : null,
        item.content,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function buildInstructions(input: {
  tonePreset: AiTonePreset;
  toneInstructions: string;
  evidence: AiRetrievedEvidence[];
}): string {
  return [
    `Reply in a ${input.tonePreset} tone.`,
    input.toneInstructions.trim(),
    'Use only the approved evidence below.',
    `If the evidence does not answer the question, reply exactly: ${GROUNDED_REFUSAL_MESSAGE}`,
    'Do not use outside knowledge, do not invent policy, and do not generalize beyond the evidence.',
    formatEvidence(input.evidence),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mapEvidenceSummary(evidence: AiRetrievedEvidence[]): AiAnswerEvidenceSummary[] {
  return evidence.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    title: item.title,
    url: item.url,
    question: item.question,
    channelId: item.channelId,
    messageId: item.messageId,
  }));
}

function filterEvidenceForReplyFrequency(
  evidence: AiRetrievedEvidence[],
  replyFrequency: AiReplyFrequency,
): AiRetrievedEvidence[] {
  if (replyFrequency !== 'low') {
    return evidence;
  }

  return evidence.filter((item) => item.sourceType === 'custom_qa' || item.score >= 4);
}

export class AiAnswerService {
  constructor(
    private readonly knowledgeRepository: AiAnswerRepositoryLike = new AiKnowledgeRepository(),
    private readonly openAi: AiGroundedResponder = { generateGroundedResponse },
  ) {}

  public async answerMessage(input: {
    guildId: string;
    question: string;
    tonePreset: AiTonePreset;
    toneInstructions: string;
    replyFrequency?: AiReplyFrequency;
  }): Promise<Result<AiAnswerResult, AppError>> {
    try {
      const evidence = await this.knowledgeRepository.retrieveEvidence({
        guildId: input.guildId,
        question: input.question,
      });
      const qualifiedEvidence = filterEvidenceForReplyFrequency(
        evidence,
        input.replyFrequency ?? 'mid',
      );

      if (qualifiedEvidence.length === 0) {
        return ok({
          kind: 'refusal',
          content: GROUNDED_REFUSAL_MESSAGE,
          evidenceCount: 0,
        });
      }

      const response = await this.openAi.generateGroundedResponse({
        instructions: buildInstructions({
          tonePreset: input.tonePreset,
          toneInstructions: input.toneInstructions,
          evidence: qualifiedEvidence,
        }),
        question: input.question,
      });

      const content = response.outputText.trim();
      if (!content || content === GROUNDED_REFUSAL_MESSAGE) {
        return ok({
          kind: 'refusal',
          content: GROUNDED_REFUSAL_MESSAGE,
          evidenceCount: 0,
        });
      }

      return ok({
        kind: 'answer',
        content,
        evidenceCount: qualifiedEvidence.length,
        evidence: mapEvidenceSummary(qualifiedEvidence),
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_ANSWER_FAILED',
              fromUnknownError(error).message || 'AI answer generation failed due to an internal error.',
              500,
            ),
      );
    }
  }
}
