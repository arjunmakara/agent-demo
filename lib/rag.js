/**
 * Shared Retrieval-Augmented-Generation helpers: chunking, Voyage AI
 * embeddings, and cosine-similarity search over the knowledge base index
 * produced by scripts/ingest-knowledge-base.js and stored in Vercel Blob.
 */

const VOYAGE_MODEL = "voyage-4-lite";
const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

function splitIntoChunks(markdown, sourceFile) {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const docTitle = titleMatch ? titleMatch[1].trim() : sourceFile;

  const lines = markdown.split("\n");
  const chunks = [];
  let currentHeading = null;
  let currentLines = [];

  const flush = () => {
    if (currentHeading && currentLines.join("\n").trim()) {
      chunks.push({
        id: `${sourceFile}#${currentHeading}`,
        source: sourceFile,
        docTitle,
        heading: currentHeading,
        text: currentLines.join("\n").trim(),
      });
    }
  };

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flush();
      currentHeading = h2Match[1].trim();
      currentLines = [];
    } else if (currentHeading) {
      currentLines.push(line);
    }
  }
  flush();

  return chunks;
}

async function embed(texts, inputType, apiKey) {
  const res = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data.map((item) => item.embedding);
}

function embedDocuments(texts, apiKey) {
  return embed(texts, "document", apiKey);
}

function embedQuery(text, apiKey) {
  return embed([text], "query", apiKey).then((embeddings) => embeddings[0]);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

let cachedIndex = null;
let cachedIndexUrl = null;

// The knowledge base index lives in a private Vercel Blob store, so reads
// require the same bearer token as writes (see scripts/ingest-knowledge-base.js).
async function loadIndex(indexUrl, blobToken) {
  if (cachedIndex && cachedIndexUrl === indexUrl) {
    return cachedIndex;
  }
  const res = await fetch(indexUrl, {
    headers: { Authorization: `Bearer ${blobToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch knowledge base index (${res.status})`);
  }
  cachedIndex = await res.json();
  cachedIndexUrl = indexUrl;
  return cachedIndex;
}

async function searchPolicies({ query, indexUrl, voyageApiKey, blobToken, topK = 4 }) {
  const [index, queryEmbedding] = await Promise.all([
    loadIndex(indexUrl, blobToken),
    embedQuery(query, voyageApiKey),
  ]);

  const scored = index.chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

module.exports = {
  VOYAGE_MODEL,
  splitIntoChunks,
  embedDocuments,
  embedQuery,
  cosineSimilarity,
  loadIndex,
  searchPolicies,
};
