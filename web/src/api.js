import { buildSummaryQuery } from "./lib/metrics.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** GET /summary for a date range ({ from, to } as YYYY-MM-DD or null). */
export async function fetchSummary(range, signal) {
  const query = buildSummaryQuery(range);
  let response;
  try {
    response = await fetch(`/api/summary${query ? `?${query}` : ""}`, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError("Could not reach the API. Is it running?", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw new ApiError(detail, response.status);
  }
  return response.json();
}
