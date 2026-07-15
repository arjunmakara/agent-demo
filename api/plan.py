"""
Vercel Python serverless function backing the website's floating travel-agent
widget. Same question set, prompt template, and Claude model as the terminal
version (agent-demo2/agent-demo2.py) so the website behaves the same way.
"""

from http.server import BaseHTTPRequestHandler
import json
import os

import anthropic

MODEL = "claude-opus-4-8"

SYSTEM_PROMPT = (
    "You are an experienced, practical travel agent. You give specific, "
    "well-reasoned vacation and flight guidance grounded in the traveler's "
    "stated budget, dates, and preferences. You are honest about the limits "
    "of your knowledge (no live flight pricing or availability) while still "
    "giving genuinely useful, concrete estimates and recommendations."
)

REQUIRED_FIELDS = [
    "origin",
    "destination_preference",
    "dates",
    "travelers",
    "budget",
    "trip_style",
]


def build_prompt(details: dict) -> str:
    lines = [
        "A traveler wants help planning a vacation. Here is what they told me:",
        "",
        f"- Departing from: {details.get('origin', '')}",
        f"- Destination preference: {details.get('destination_preference', '')}",
        f"- Travel dates / trip length: {details.get('dates', '')}",
        f"- Travelers: {details.get('travelers', '')}",
        f"- Budget: {details.get('budget', '')}",
        f"- Trip style: {details.get('trip_style', '')}",
    ]
    if details.get("climate"):
        lines.append(f"- Climate preference: {details['climate']}")
    if details.get("pace"):
        lines.append(f"- Pace: {details['pace']}")
    if details.get("must_haves"):
        lines.append(f"- Must-haves / avoid: {details['must_haves']}")
    if details.get("flight_class"):
        lines.append(f"- Preferred flight class: {details['flight_class']}")

    lines += [
        "",
        "Please respond with:",
        "1. **Top 3 destination recommendations** matched to their preferences and "
        "budget, each with a 2-3 sentence rationale, best time to visit, and a rough "
        "daily budget estimate (lodging + food + activities) in USD.",
        "2. **Flight guidance** for each recommended destination: likely route/"
        "connection pattern from their departure city, typical flight duration, "
        "a realistic round-trip fare range in USD for their preferred class, and "
        "which airlines or alliances commonly serve that route. Note that you "
        "don't have live pricing, so fares are informed estimates, not bookable "
        "quotes.",
        "3. **A simple day-by-day outline** (just a skeleton, not a minute-by-minute "
        "itinerary) for your top overall pick, sized to their trip length.",
        "4. **Practical notes**: visa/entry requirements to check, ideal booking "
        "window, and any budget or logistics red flags given what they told you.",
        "",
        "Be concrete and use their stated budget and dates to sanity-check "
        "feasibility - call it out plainly if something doesn't fit. Keep it "
        "well-organized with headers, not a wall of text.",
    ]
    return "\n".join(lines)


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            details = json.loads(raw or b"{}")
            if not isinstance(details, dict):
                raise ValueError("body must be a JSON object")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid request body."})
            return

        missing = [f for f in REQUIRED_FIELDS if not str(details.get(f, "")).strip()]
        if missing:
            self._send_json(
                400, {"error": f"Missing required fields: {', '.join(missing)}"}
            )
            return

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            self._send_json(500, {"error": "Server is missing ANTHROPIC_API_KEY."})
            return

        client = anthropic.Anthropic(api_key=api_key)
        prompt = build_prompt(details)

        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=8000,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.AuthenticationError:
            self._send_json(500, {"error": "Invalid ANTHROPIC_API_KEY on the server."})
            return
        except anthropic.APIError as e:
            self._send_json(502, {"error": f"Claude API error: {e}"})
            return

        text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        self._send_json(200, {"text": text})
