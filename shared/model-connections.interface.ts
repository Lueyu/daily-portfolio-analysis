/** User-owned OpenAI-compatible connections; public responses never contain credentials. */
export interface ModelConnection {
  id: string;
  name: string;
  baseUrl: string;
  fastModel: string;
  slowModel: string;
  hasApiKey: boolean;
  available: boolean;
  maskedApiKey?: string;
  needsReentry?: boolean;
}
export interface SaveModelConnection {
  name: string;
  baseUrl: string;
  fastModel: string;
  slowModel: string;
  apiKey?: string;
}
