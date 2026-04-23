import OpenAI from 'openai';

import { getEnv } from '../config/env.js';
import { AppError } from '../domain/errors.js';

export type GenerateGroundedResponseInput = {
  instructions: string;
  question: string;
};

export type GenerateGroundedResponseOutput = {
  outputText: string;
  requestId: string | null;
  model: string;
};

export function createOpenAiClient(): OpenAI {
  const env = getEnv();

  if (!env.OPENAI_API_KEY.trim()) {
    throw new AppError('OPENAI_API_KEY_MISSING', 'OPENAI_API_KEY is not configured.', 500);
  }

  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
}

export async function generateGroundedResponse(
  input: GenerateGroundedResponseInput,
): Promise<GenerateGroundedResponseOutput> {
  const env = getEnv();
  const client = createOpenAiClient();
  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    instructions: input.instructions,
    input: input.question,
  });

  return {
    outputText: response.output_text,
    requestId: response._request_id ?? null,
    model: env.OPENAI_MODEL,
  };
}
