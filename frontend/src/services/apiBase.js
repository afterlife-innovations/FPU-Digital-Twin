const configuredApiBase = import.meta.env.VITE_API_URL?.replace(/\/+$/, "");
const localApiBase =
  import.meta.env.DEV && typeof window !== "undefined"
    ? `http://${window.location.hostname}:8000`
    : "";

export const API_BASE = configuredApiBase || localApiBase;
