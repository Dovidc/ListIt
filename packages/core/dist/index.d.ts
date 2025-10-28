export type RequestPriority = 'high' | 'low' | 'auto';

export interface RequestMeta {
  silent?: boolean;
  priority?: RequestPriority;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRequestStart?: () => void;
  onRequestEnd?: () => void;
  onUnauthorized?: () => void;
  onAccountLocked?: () => void;
}

export interface ApiClient {
  request<T = unknown>(path: string, init?: RequestInit & { priority?: RequestPriority }, meta?: RequestMeta): Promise<T | null>;
  me(meta?: RequestMeta): Promise<unknown>;
  login(email: string, password: string, meta?: RequestMeta): Promise<unknown>;
  register(payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  logout(meta?: RequestMeta): Promise<void>;
  pushSubscribe(subscription: unknown, meta?: RequestMeta): Promise<unknown>;
  pushUnsubscribe(subscription: unknown, meta?: RequestMeta): Promise<unknown>;
  updatePaypalEmail(paypalEmail: string, meta?: RequestMeta): Promise<unknown>;
  listAll(params?: Record<string, unknown> | string, locOrMeta?: unknown, meta?: RequestMeta): Promise<unknown>;
  listListings(params?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  getUser(userId: number | string, meta?: RequestMeta): Promise<unknown>;
  listByUser(userId: number | string, meta?: RequestMeta): Promise<unknown>;
  listMine(meta?: RequestMeta): Promise<unknown>;
  createListing(payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  updateListing(id: number | string, payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  markListingSold(id: number | string, sold: boolean, meta?: RequestMeta): Promise<unknown>;
  deleteListing(id: number | string, meta?: RequestMeta): Promise<unknown>;
  adminDeleteListing(id: number | string, meta?: RequestMeta): Promise<unknown>;
  adminDeleteAll(meta?: RequestMeta): Promise<unknown>;
  adminSeedListings(payload?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminDeleteSeedListings(meta?: RequestMeta): Promise<unknown>;
  listAds(meta?: RequestMeta): Promise<unknown>;
  adminListFlagged(meta?: RequestMeta): Promise<unknown>;
  adminDeleteFlagged(id: number | string, meta?: RequestMeta): Promise<unknown>;
  adminListAds(meta?: RequestMeta): Promise<unknown>;
  adminCreateAd(payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminUpdateAd(id: number | string, payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminDeleteAd(id: number | string, meta?: RequestMeta): Promise<unknown>;
  searchCities(query: string, meta?: RequestMeta): Promise<unknown>;
  ensureConversation(payload: { with_user_id: number | string; listing_id?: number | string | null }, meta?: RequestMeta): Promise<unknown>;
  listConversations(meta?: RequestMeta): Promise<unknown>;
  getMessages(id: number | string, meta?: RequestMeta): Promise<unknown>;
  sendMessage(id: number | string, body: string, images: unknown, meta?: RequestMeta): Promise<unknown>;
  deleteConversation(id: number | string, meta?: RequestMeta): Promise<unknown>;
  getListingImages(id: number | string, meta?: RequestMeta): Promise<unknown>;
  getCoversBatch(ids: Array<number | string>, meta?: RequestMeta): Promise<unknown>;
  aiAnalyze(payload: { images: unknown; hint: string | null }, meta?: RequestMeta): Promise<unknown>;
  reverseGeocode(lat: number, lon: number, meta?: RequestMeta): Promise<unknown>;
  listNearby(lat: number, lon: number, radiusMeters?: number, meta?: RequestMeta): Promise<unknown>;
  reportSeller(payload: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminSearchUsers(params?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminGetUser(id: number | string, meta?: RequestMeta): Promise<unknown>;
  adminGetUserReports(id: number | string, params?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminUpdateUserStatus(id: number | string, payload?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminTopReports(params?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  adminClearUserReports(id: number | string, payload?: Record<string, unknown>, meta?: RequestMeta): Promise<unknown>;
  signUpload(args: { filename: string; contentType: string; bytes: number }, meta?: RequestMeta): Promise<unknown>;
  finalizeUpload(args: { listingId?: number; key?: string; url?: string; width?: number | null; height?: number | null; bytes?: number | null }, meta?: RequestMeta): Promise<unknown>;
}

export declare class ApiError extends Error {
  responseText?: string;
}

export declare function createApiClient(options?: ApiClientOptions): ApiClient;
export declare const formatCurrency: (value: unknown, currency?: string) => string;
export declare const formatDistance: (meters: number | null | undefined) => string;
export declare const haversineMeters: (aLat: number, aLon: number, bLat: number, bLon: number) => number;

declare const _default: {
  createApiClient: typeof createApiClient;
  formatCurrency: typeof formatCurrency;
  formatDistance: typeof formatDistance;
  haversineMeters: typeof haversineMeters;
};
export default _default;
