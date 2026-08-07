type AgentAttachment = {
  name: string;
  kind: string;
  text?: string;
};

type AgentMessage = {
  role: string;
  text: string;
};

type AgentChatPayload = {
  question?: string;
  deterministic_answer?: string;
  deterministic_findings?: Record<string, unknown>;
  screen_context?: Record<string, unknown>;
  attachments?: AgentAttachment[];
  chat_history?: AgentMessage[];
};

declare const process: { env: Record<string, string | undefined> };

const model = process.env.OPENAI_MODEL || "gpt-5-mini";
const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 420);

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const payload = (await request.json()) as AgentChatPayload;
  const deterministicAnswer = payload.deterministic_answer || localAgentAnswer(payload);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({
      answer: `${deterministicAnswer}\n\nAI layer is not configured yet. Add OPENAI_API_KEY as a Vercel server-side environment variable to enable the economical model pass.`,
      deterministic_answer: deterministicAnswer,
      used_api: false,
      warning: "OPENAI_API_KEY is not configured."
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: compactCaseFile(payload, deterministicAnswer),
      instructions: [
        "You are the PSR1 inference agent for semiconductor PM1 sensor anomaly review.",
        "Start from deterministic troubleshooting findings before adding synthesis.",
        "Use live chart, selected plot, SPC windows, ML metrics, alert history, and user context when present.",
        "Be concise, connect multiple datapoints, and never claim confirmed fault/root cause.",
        "Always include: This is anomaly evidence, not confirmed fault classification."
      ].join(" "),
      max_output_tokens: maxOutputTokens,
      model
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? "authentication failed; check the server-side OPENAI_API_KEY value."
      : (await response.text()).slice(0, 700);
    return json({
      answer: `${deterministicAnswer}\n\nAI layer could not complete: OpenAI API returned ${response.status}.`,
      deterministic_answer: deterministicAnswer,
      model,
      used_api: false,
      warning: detail
    }, 200);
  }

  const result = await response.json();
  return json({
    answer: extractResponseText(result),
    deterministic_answer: deterministicAnswer,
    model,
    used_api: true
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function compactCaseFile(payload: AgentChatPayload, deterministicAnswer: string): string {
  return JSON.stringify({
    attachments: (payload.attachments || []).slice(0, 5).map((item) => ({
      kind: item.kind?.slice(0, 80),
      name: item.name?.slice(0, 160),
      text: item.text?.slice(0, 1800)
    })),
    caveat: "This is anomaly evidence, not confirmed fault classification.",
    deterministic_answer_first: deterministicAnswer.slice(0, 2400),
    deterministic_findings: boundedJson(payload.deterministic_findings || {}, 3500),
    project: "PSR1 real-time sensor anomaly detection and explanation system",
    question: (payload.question || "").slice(0, 1200),
    recent_chat: (payload.chat_history || []).slice(-6).map((item) => ({
      role: item.role?.slice(0, 20),
      text: item.text?.slice(0, 700)
    })),
    screen_context: boundedJson(payload.screen_context || {}, 5000)
  });
}

function localAgentAnswer(payload: AgentChatPayload): string {
  const context = payload.screen_context || {};
  const alert = (context.current_alert || {}) as Record<string, unknown>;
  const chart = (context.live_chart || {}) as Record<string, unknown>;
  const windowRecord = (context.selected_window || {}) as Record<string, unknown>;
  const sensor = alert.sensor || chart.sensor || windowRecord.sensor_name || "the selected sensor";
  const step = alert.processStep || chart.processStep || windowRecord.process_step || "the selected step";
  return [
    `Deterministic review first: ${sensor} at step ${step} is being treated as anomaly evidence, not confirmed fault classification.`,
    "Check SPC/range guardrails, clean ML probability, selected output plots, live chart shape, hotspot status, and available logs before escalating.",
    "Recommended actions: compare neighboring sensors, verify recipe/product context, inspect maintenance notes, and ask an engineer to review persistent or repeated evidence."
  ].join("\n");
}

function boundedJson(value: unknown, limit: number): unknown {
  const text = JSON.stringify(value);
  return text.length <= limit ? value : { truncated_json: text.slice(0, limit), truncated: true };
}

function extractResponseText(payload: any): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim() || "AI response completed, but no text was returned.";
}
