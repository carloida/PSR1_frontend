import { mockData } from "./mockData";
import type { DashboardData, SensorStream } from "./types";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8002";

export type PipelineStep = "validate" | "eda" | "spc" | "ml" | "faults" | "all";

export type PipelineRunResult = {
  step: PipelineStep;
  label: string;
  ok: boolean;
  message?: string;
  duration_seconds?: number;
  stdout?: string;
  stderr?: string;
  results?: PipelineRunResult[];
  details?: Record<string, unknown>;
};

export type UploadResult = {
  ok: boolean;
  filename: string;
  message: string;
  canonical_csv: string;
  columns: string[];
  preview_rows: number;
};

export async function fetchDashboardData(): Promise<{ data: DashboardData; source: "api" | "sample" }> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/dashboard`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const data = (await response.json()) as DashboardData;
    return { data, source: "api" };
  } catch {
    return { data: mockData, source: "sample" };
  }
}

export async function runPipelineStep(step: PipelineStep): Promise<PipelineRunResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/pipeline/run/${step}`, { method: "POST" });
  } catch {
    throw new Error(`Cannot reach the local PSR1 API at ${apiBaseUrl}. Start the backend on port 8002, or open the dashboard with the Desktop shortcut so frontend and API start together.`);
  }
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as PipelineRunResult;
}

export async function uploadSourceFile(file: File): Promise<UploadResult> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/ingest/upload`, {
      body,
      method: "POST"
    });
  } catch {
    throw new Error(`Cannot reach the local PSR1 API at ${apiBaseUrl}. Start the backend on port 8002, or open the dashboard with the Desktop shortcut so frontend and API start together.`);
  }
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as UploadResult;
}

export async function fetchSensorStream(sensor?: string, step?: string): Promise<SensorStream> {
  const url = new URL(`${apiBaseUrl}/api/live/sensor-stream`);
  if (sensor) {
    url.searchParams.set("sensor", sensor);
  }
  if (step && step !== "All steps") {
    url.searchParams.set("step", step);
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Cannot reach the local PSR1 API at ${apiBaseUrl}. Start the backend on port 8002, or open the dashboard with the Desktop shortcut so frontend and API start together.`);
  }
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as SensorStream;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (payload.detail?.stderr) {
      return payload.detail.stderr;
    }
    return JSON.stringify(payload.detail ?? payload);
  } catch {
    return `API returned ${response.status}`;
  }
}
