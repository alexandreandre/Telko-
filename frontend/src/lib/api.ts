export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "";
  }
  throw new Error(
    "VITE_API_URL doit pointer vers le backend FastAPI (ex. http://127.0.0.1:8000).",
  );
}
