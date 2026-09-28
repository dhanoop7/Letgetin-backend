import { GoogleProvider } from '../modules/ai/providers/google.provider.js';
import { GoogleEmbeddingProvider } from '../modules/embedding/providers/google.embedding.provider.js';

async function verifyBackendIntegration() {
  console.log('====================================================');
  console.log('Testing GoogleProvider and GoogleEmbeddingProvider');
  console.log('====================================================\n');

  // 1. GoogleProvider (Generative AI)
  console.log('1. Testing GoogleProvider.getInstance().generate()...');
  try {
    const provider = GoogleProvider.getInstance();
    const result = await provider.generate({
      prompt: 'Summarize in one sentence the benefits of automated talent matching.',
      promptName: 'test-summary',
    });
    console.log('✅ GoogleProvider SUCCESS!');
    console.log('   Response Text:', result.text);
    console.log(`   Execution Time: ${result.executionTimeMs}ms`);
    console.log(`   Request ID: ${result.requestId}`);
  } catch (err: any) {
    console.error('❌ GoogleProvider FAILED:', err?.message || err);
  }

  // 2. GoogleEmbeddingProvider (Embeddings)
  console.log('\n2. Testing GoogleEmbeddingProvider.generateEmbedding()...');
  try {
    const embedProvider = new GoogleEmbeddingProvider();
    const vector = await embedProvider.generateEmbedding(
      'Senior Full Stack Engineer with expertise in Node.js, TypeScript, React, and MongoDB.'
    );
    console.log('✅ GoogleEmbeddingProvider SUCCESS!');
    console.log(`   Dimensions: ${vector.length}`);
    console.log(`   Sample vector slice (first 5): [${vector.slice(0, 5).map(n => n.toFixed(5)).join(', ')}]`);
  } catch (err: any) {
    console.error('❌ GoogleEmbeddingProvider FAILED:', err?.message || err);
  }

  console.log('\n====================================================');
  console.log('ALL GEMINI INTEGRATION CHECKS COMPLETE');
  console.log('====================================================');
}

verifyBackendIntegration().catch(console.error);
