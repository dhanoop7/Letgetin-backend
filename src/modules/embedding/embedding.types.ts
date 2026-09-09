export interface IEmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings?(texts: string[]): Promise<number[][]>;
}

export type EmbeddingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  version: string;
  dimensions: number;
  executionTimeMs: number;
}
