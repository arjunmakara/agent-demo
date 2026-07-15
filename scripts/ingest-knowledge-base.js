/**
 * One-time / re-run-on-change ingestion script:
 * reads the markdown files in knowledge_base/, splits them into per-section
 * chunks, embeds each chunk with Voyage AI, and uploads the resulting index
 * to Vercel Blob storage so both the website and the terminal app can fetch
 * it at runtime.
 *
 * Usage:
 *   VOYAGE_API_KEY=... BLOB_READ_WRITE_TOKEN=... node scripts/ingest-knowledge-base.js
 * or with a .env.local file present in agent-demo/:
 *   node scripts/ingest-knowledge-base.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const fs = require("fs");
const path = require("path");
const { put } = require("@vercel/blob");
const { splitIntoChunks, embedDocuments, VOYAGE_MODEL } = require("../lib/rag");

const KB_DIR = path.join(__dirname, "..", "knowledge_base");
const INDEX_PATHNAME = "knowledge-base/index.json";

async function main() {
  const voyageApiKey = process.env.VOYAGE_API_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (!voyageApiKey) {
    console.error("Missing VOYAGE_API_KEY (set it in agent-demo/.env.local or the environment).");
    process.exit(1);
  }
  if (!blobToken) {
    console.error("Missing BLOB_READ_WRITE_TOKEN (set it in agent-demo/.env.local or the environment).");
    process.exit(1);
  }

  const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith(".md"));
  if (!files.length) {
    console.error(`No markdown files found in ${KB_DIR}`);
    process.exit(1);
  }

  let chunks = [];
  for (const file of files) {
    const markdown = fs.readFileSync(path.join(KB_DIR, file), "utf8");
    chunks = chunks.concat(splitIntoChunks(markdown, file));
  }

  console.log(`Chunked ${files.length} file(s) into ${chunks.length} section(s).`);

  console.log(`Embedding ${chunks.length} chunk(s) with ${VOYAGE_MODEL}...`);
  const embeddings = await embedDocuments(
    chunks.map((c) => `${c.docTitle} - ${c.heading}\n\n${c.text}`),
    voyageApiKey
  );

  const indexedChunks = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
  }));

  const index = {
    model: VOYAGE_MODEL,
    generatedAt: new Date().toISOString(),
    chunks: indexedChunks,
  };

  console.log(`Uploading index (${indexedChunks.length} chunks) to Vercel Blob (private)...`);
  const blob = await put(INDEX_PATHNAME, JSON.stringify(index), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken,
  });

  console.log("\nDone. Knowledge base index URL (private - requires bearer token to read):");
  console.log(blob.url);
  console.log("\nSet this as KB_INDEX_URL in agent-demo/.env.local, agent-demo2/config.env,");
  console.log("and the Vercel project's environment variables. Reads also require");
  console.log("BLOB_READ_WRITE_TOKEN to be set alongside it (already present).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
