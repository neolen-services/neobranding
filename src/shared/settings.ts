/** Outside services the app calls with the user's own key or token. */
export const API_PROVIDERS = ["anthropic", "deepgram", "telegram"] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const isApiProvider = (v: unknown): v is ApiProvider => API_PROVIDERS.includes(v as ApiProvider);
