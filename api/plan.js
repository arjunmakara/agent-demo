/**
 * Vercel Node.js serverless function backing the website's floating
 * travel-agent widget. Same question set, prompt template, system prompt,
 * and Claude model as the terminal version (agent-demo2/agent-demo2.py) so
 * the website behaves the same way.
 */

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT =
  "You are an experienced, practical travel agent. You give specific, " +
  "well-reasoned vacation and flight guidance grounded in the traveler's " +
  "stated budget, dates, and preferences. You are honest about the limits " +
  "of your knowledge (no live flight pricing or availability) while still " +
  "giving genuinely useful, concrete estimates and recommendations.";

const REQUIRED_FIELDS = [
  "origin",
  "destination_preference",
  "dates",
  "travelers",
  "budget",
  "trip_style",
];

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
      "window, and any budget or logistics red flags given what they told you.",
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

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    res.status(200).json({ text });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "Invalid ANTHROPIC_API_KEY on the server." });
      return;
    }
    res.status(502).json({ error: `Claude API error: ${err.message}` });
  }
};
