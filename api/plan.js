/**
 * Vercel Node.js serverless function backing the website's floating
 * travel-agent widget. Same question set, prompt template, system prompt,
 * and Claude model as the terminal version (agent-demo2/agent-demo2.py) so
 * the website behaves the same way.
 *
 * Agentic RAG: Claude has a `search_policies` tool over a knowledge base of
 * cancellation, baggage, and travel-insurance policy documents (embedded
 * with Voyage AI, indexed in Vercel Blob). Claude decides on its own
 * whether a given trip's must-haves or policy questions warrant a lookup.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { betaTool } = require("@anthropic-ai/sdk/helpers/beta/json-schema");
const { searchPolicies } = require("../lib/rag");

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT_BASE =
  "You are an experienced, practical travel agent. You give specific, " +
  "well-reasoned vacation and flight guidance grounded in the traveler's " +
  "stated budget, dates, and preferences. You are honest about the limits " +
  "of your knowledge (no live flight pricing or availability) while still " +
  "giving genuinely useful, concrete estimates and recommendations.";

const SYSTEM_PROMPT_RAG_SUFFIX =
  " When the traveler's must-haves or policy questions touch on " +
  "cancellation, baggage, or travel insurance, use the search_policies " +
  "tool to ground your answer in the company's actual policy documents " +
  "instead of guessing, and cite what the policy says.";

const REQUIRED_FIELDS = [
  "origin",
  "destination_preference",
  "dates",
  "travelers",
  "budget",
  "trip_style",
];

function formatPolicyResults(results) {
  if (!results.length) {
    return "No relevant policy information found.";
  }
  return results
    .map(
      ({ chunk, score }) =>
        `[${chunk.docTitle} - ${chunk.heading}] (relevance ${score.toFixed(2)})\n${chunk.text}`
    )
    .join("\n\n---\n\n");
}

function buildSearchPoliciesTool(voyageApiKey, indexUrl, blobToken) {
  return betaTool({
    name: "search_policies",
    description:
      "Search Wayfare's cancellation, baggage, and travel-insurance policy " +
      "knowledge base for information relevant to a traveler's question. " +
      "Call this whenever the traveler's must-haves, avoid-list, or policy " +
      "questions touch on refund/cancellation rules, baggage allowances or " +
      "fees, or travel insurance coverage - ground your answer in the " +
      "retrieved text rather than general knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A natural-language description of the policy information " +
            "needed, e.g. 'refund policy for cancelling 3 days before " +
            "departure' or 'checked baggage allowance and overweight fees'.",
        },
      },
      required: ["query"],
    },
    run: async ({ query }) => {
      const results = await searchPolicies({ query, indexUrl, voyageApiKey, blobToken });
      return formatPolicyResults(results);
    },
  });
}

function buildPrompt(details) {
  const lines = [
    "A traveler wants help planning a vacation. Here is what they told me:",
    "",
    `- Departing from: ${details.origin || ""}`,
    `- Destination preference: ${details.destination_preference || ""}`,
    `- Travel dates / trip length: ${details.dates || ""}`,
    `- Travelers: ${details.travelers || ""}`,
    `- Budget: ${details.budget || ""}`,
    `- Trip style: ${details.trip_style || ""}`,
  ];
  if (details.climate) lines.push(`- Climate preference: ${details.climate}`);
  if (details.pace) lines.push(`- Pace: ${details.pace}`);
  if (details.must_haves)
    lines.push(`- Must-haves / avoid: ${details.must_haves}`);
  if (details.flight_class)
    lines.push(`- Preferred flight class: ${details.flight_class}`);
  if (details.policy_questions)
    lines.push(
      `- Cancellation / baggage / insurance questions: ${details.policy_questions}`
    );

  lines.push(
    "",
    "Please respond with:",
    "1. **Top 3 destination recommendations** matched to their preferences and " +
      "budget, each with a 2-3 sentence rationale, best time to visit, and a rough " +
      "daily budget estimate (lodging + food + activities) in USD.",
    "2. **Flight guidance** for each recommended destination: likely route/" +
      "connection pattern from their departure city, typical flight duration, " +
      "a realistic round-trip fare range in USD for their preferred class, and " +
      "which airlines or alliances commonly serve that route. Note that you " +
      "don't have live pricing, so fares are informed estimates, not bookable " +
      "quotes.",
    "3. **A simple day-by-day outline** (just a skeleton, not a minute-by-minute " +
      "itinerary) for your top overall pick, sized to their trip length.",
    "4. **Practical notes**: visa/entry requirements to check, ideal booking " +
      "window, and any budget or logistics red flags given what they told you."
  );

  if (details.policy_questions) {
    lines.push(
      "5. **Policy answers**: answer their cancellation / baggage / insurance " +
        "question(s) using the search_policies tool, grounded in the actual " +
        "policy text - don't guess."
    );
  }

  lines.push(
    "",
    "Be concrete and use their stated budget and dates to sanity-check " +
      "feasibility - call it out plainly if something doesn't fit. Keep it " +
      "well-organized with headers, not a wall of text."
  );

  return lines.join("\n");
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    res.status(200).json({
      status: "ok",
      message: "This endpoint accepts POST with trip details as JSON.",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const details =
    typeof req.body === "object" && req.body !== null ? req.body : {};

  const missing = REQUIRED_FIELDS.filter(
    (field) => !String(details[field] || "").trim()
  );
  if (missing.length) {
    res
      .status(400)
      .json({ error: `Missing required fields: ${missing.join(", ")}` });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    return;
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt(details);

  const voyageApiKey = process.env.VOYAGE_API_KEY;
  const indexUrl = process.env.KB_INDEX_URL;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const ragEnabled = Boolean(voyageApiKey && indexUrl && blobToken);

  try {
    const requestParams = {
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [{ role: "user", content: prompt }],
    };

    let text;
    if (ragEnabled) {
      const searchPoliciesTool = buildSearchPoliciesTool(voyageApiKey, indexUrl, blobToken);
      const finalMessage = await client.beta.messages.toolRunner({
        ...requestParams,
        system: SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_RAG_SUFFIX,
        tools: [searchPoliciesTool],
      });
      text = finalMessage.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } else {
      const response = await client.messages.create({
        ...requestParams,
        system: SYSTEM_PROMPT_BASE,
      });
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    }

    res.status(200).json({ text });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "Invalid ANTHROPIC_API_KEY on the server." });
      return;
    }
    res.status(502).json({ error: `Claude API error: ${err.message}` });
  }
};
