(() => {
  const QUESTIONS = [
    {
      key: "origin",
      text: "Where are you traveling from (city/airport)? ",
      required: true,
    },
    {
      key: "destination_preference",
      text:
        "Do you have a destination in mind, or should I suggest one? " +
        "(e.g. 'Japan', 'anywhere warm', 'not sure - surprise me') ",
      required: true,
    },
    {
      key: "dates",
      text:
        "When do you want to travel, and for how long? " +
        "(e.g. 'first two weeks of March, 7 days') ",
      required: true,
    },
    {
      key: "travelers",
      text:
        "Who's traveling? (e.g. 'solo', '2 adults', 'family of 4 with young kids') ",
      required: true,
    },
    {
      key: "budget",
      text: "What's your total budget, roughly? (e.g. '$3000 for two people') ",
      required: true,
    },
    {
      key: "trip_style",
      text:
        "What kind of trip are you after? " +
        "(e.g. beach relaxation, adventure/hiking, city culture, food, nightlife, mix) ",
      required: true,
    },
    {
      key: "climate",
      text: "Any climate preference? (e.g. warm and sunny, cool, no preference) ",
      required: false,
    },
    {
      key: "pace",
      text: "Pace of the trip? (e.g. relaxed/one base, fast-paced multi-city) ",
      required: false,
    },
    {
      key: "must_haves",
      text:
        "Anything you must have or want to avoid? " +
        "(e.g. direct flights only, kid-friendly, no long layovers, visa-free) ",
      required: false,
    },
    {
      key: "flight_class",
      text: "Preferred flight class? (economy, premium economy, business, no preference) ",
      required: false,
    },
  ];

  const output = document.getElementById("widget-output");
  const form = document.getElementById("widget-form");
  const input = document.getElementById("widget-input");
  const widget = document.getElementById("widget");
  const launcher = document.getElementById("launcher");
  const launchBtn = document.getElementById("launch-btn");
  const closeBtn = document.getElementById("widget-close");
  const header = document.getElementById("widget-header");

  let answers = {};
  let qIndex = 0;
  let phase = "asking"; // asking | loading | done
  let currentAnswerSpan = null;
  let started = false;

  function appendLine(text, className) {
    const el = document.createElement("div");
    if (className) el.className = className;
    el.textContent = text;
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
    return el;
  }

  function appendBlank() {
    appendLine("", null);
  }

  function scrollToBottom() {
    output.scrollTop = output.scrollHeight;
  }

  function askCurrentQuestion() {
    const q = QUESTIONS[qIndex];
    const line = document.createElement("div");
    line.className = "line-question";

    const label = document.createElement("span");
    label.textContent = q.text;

    const answerSpan = document.createElement("span");
    answerSpan.className = "line-answer";

    line.appendChild(label);
    line.appendChild(answerSpan);
    output.appendChild(line);
    scrollToBottom();

    currentAnswerSpan = answerSpan;
    input.disabled = false;
    input.value = "";
    input.focus();
  }

  function beginIntake() {
    appendLine("=".repeat(60), "line-banner");
    appendLine("  Claude Travel Agent", "line-banner");
    appendLine("=".repeat(60), "line-banner");
    appendLine("Answer a few questions and I'll suggest vacation spots", "line-banner");
    appendLine("and flight options tailored to your trip.", "line-banner");
    appendBlank();
    askCurrentQuestion();
  }

  function typewrite(text) {
    return new Promise((resolve) => {
      const container = document.createElement("div");
      output.appendChild(container);
      let i = 0;
      const chunkSize = 3;
      function step() {
        container.textContent += text.slice(i, i + chunkSize);
        i += chunkSize;
        scrollToBottom();
        if (i < text.length) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      step();
    });
  }

  async function finishIntake() {
    phase = "loading";
    input.disabled = true;
    appendBlank();
    appendLine("=".repeat(60), "line-banner");
    appendLine("  Planning your trip...", "line-banner");
    appendLine("=".repeat(60), "line-banner");
    appendBlank();

    const thinkingLine = appendLine("Thinking…", "line-system");
    let dots = 0;
    const spinner = setInterval(() => {
      dots = (dots + 1) % 4;
      thinkingLine.textContent = "Thinking" + ".".repeat(dots);
    }, 450);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });
      const data = await res.json().catch(() => ({}));
      clearInterval(spinner);
      thinkingLine.remove();

      if (!res.ok) {
        appendLine(data.error || "Something went wrong. Please try again.", "line-error");
      } else {
        await typewrite(data.text || "(No response text received.)");
      }
    } catch (err) {
      clearInterval(spinner);
      thinkingLine.remove();
      appendLine("Network error: " + err.message, "line-error");
    }

    appendBlank();
    appendLine("=".repeat(60), "line-banner");
    appendLine("  Safe travels!", "line-banner");
    appendLine("=".repeat(60), "line-banner");
    appendBlank();
    appendLine("Type 'restart' and press Enter to plan another trip.", "line-system");

    phase = "done";
    input.disabled = false;
    input.value = "";
    input.focus();
  }

  function resetIntake() {
    output.innerHTML = "";
    answers = {};
    qIndex = 0;
    phase = "asking";
    beginIntake();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();

    if (phase === "done") {
      if (value.toLowerCase() === "restart") {
        resetIntake();
      } else {
        input.value = "";
      }
      return;
    }

    if (phase !== "asking") return;

    const q = QUESTIONS[qIndex];
    if (!value && q.required) {
      appendLine("  Please enter a value.", "line-system");
      return;
    }

    if (currentAnswerSpan) {
      currentAnswerSpan.textContent = value;
    }
    answers[q.key] = value;
    input.value = "";

    qIndex += 1;
    if (qIndex < QUESTIONS.length) {
      askCurrentQuestion();
    } else {
      finishIntake();
    }
  });

  function openWidget() {
    widget.hidden = false;
    launcher.hidden = true;
    if (!started) {
      started = true;
      beginIntake();
    } else {
      input.focus();
    }
  }

  function closeWidget() {
    widget.hidden = true;
    launcher.hidden = false;
  }

  launchBtn.addEventListener("click", openWidget);
  launcher.addEventListener("click", openWidget);
  closeBtn.addEventListener("click", closeWidget);

  // --- Dragging the widget by its header ---
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function startDrag(clientX, clientY) {
    const rect = widget.getBoundingClientRect();
    dragging = true;
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
    widget.style.right = "auto";
    widget.style.bottom = "auto";
    widget.style.left = rect.left + "px";
    widget.style.top = rect.top + "px";
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    const maxX = Math.max(0, window.innerWidth - widget.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - widget.offsetHeight);
    const x = Math.min(Math.max(0, clientX - dragOffsetX), maxX);
    const y = Math.min(Math.max(0, clientY - dragOffsetY), maxY);
    widget.style.left = x + "px";
    widget.style.top = y + "px";
  }

  function endDrag() {
    dragging = false;
  }

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest(".widget-close")) return;
    startDrag(e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", endDrag);

  header.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest(".widget-close")) return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const t = e.touches[0];
      moveDrag(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener("touchend", endDrag);
})();
