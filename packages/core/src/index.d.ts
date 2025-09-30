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
  finalizeUpload(args: { listingId?: number | string | null; key?: string; url?: string; width?: number | null; height?: number | null; bytes?: number | null }, meta?: RequestMeta): Promise<unknown>;
}

export declare class ApiError extends Error {
  responseText?: string;
}

export declare function createApiClient(options?: ApiClientOptions): ApiClient;
export declare const formatCurrency: (value: unknown, currency?: string) => string;
export declare const formatDistance: (meters: number | null | undefined) => string;
export declare const haversineMeters: (aLat: number, aLon: number, bLat: number, bLon: number) => number;

export declare function normalizeListingsResponse(res: unknown, limit?: number): {
  rows: unknown[];
  hasNext: boolean;
  nextCursor: string | null;
};

export declare const asArray: <T = unknown>(input: unknown) => T[];

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthTokens {
  token: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
}

export interface AuthResult {
  user: Record<string, unknown> | null;
  tokens: AuthTokens | null;
  raw: unknown;
}

export interface AuthService {
  validateCredentials(input: Partial<AuthCredentials>): AuthCredentials;
  signIn(credentials: AuthCredentials, meta?: RequestMeta): Promise<AuthResult>;
  signOut(meta?: RequestMeta): Promise<void>;
  extractTokens(response: unknown): AuthTokens | null;
}

export declare function createAuthService(options: { api: ApiClient }): AuthService;

export interface ListingSummary {
  id: string;
  title: string;
  subtitle: string;
  price?: number | null;
  location?: string | null;
  raw: unknown;
}

export interface ListingsFetchParams {
  query?: string;
  location?: string;
  cursor?: string | null;
  limit?: number;
  sort?: string;
}

export interface ListingsFetchResult<T = unknown> {
  rows: T[];
  items: ListingSummary[];
  hasNext: boolean;
  nextCursor: string | null;
}

export interface ListingsService {
  fetch<T = unknown>(params?: ListingsFetchParams, meta?: RequestMeta): Promise<ListingsFetchResult<T>>;
  fetchSummaries(params?: ListingsFetchParams, meta?: RequestMeta): Promise<ListingSummary[]>;
  toSummary(listing: unknown): ListingSummary | null;
  normalize<T = unknown>(value: T, limit?: number): ReturnType<typeof normalizeListingsResponse>;
}

export declare function createListingsService(options: { api: ApiClient; pageSize?: number; formatPrice?: (value: unknown) => string }): ListingsService;

export interface UploadDraftResult {
  uploadToken: string;
  publicUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

export interface Base64UploadOptions {
  filename?: string;
  contentType?: string;
  listingId?: number | string | null;
  meta?: RequestMeta;
}

export interface UploadUtilities {
  measureImageFile(file: File): Promise<{ width?: number | null; height?: number | null }>;
  dedupeImageUrls(urls: Array<string | null | undefined>): string[];
  collectListingImages(listing: unknown, coverHint?: string): string[];
}

export interface CreateUploadsServiceOptions {
  api: ApiClient;
  utils: UploadUtilities;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface UploadsService {
  clearDraftCacheForFile(file: unknown): void;
  uploadFileDraft(file: File): Promise<UploadDraftResult>;
  fetchListingImagesCached(listingId: number | string, options?: { minCount?: number }): Promise<string[]>;
  prepareListingForModal(listing: unknown, coverHint?: string): { payload: Record<string, unknown> | null; images: string[]; cover: string };
  warmListingImages(listingId: number | string, baseImages?: number | string[] | null): void;
  uploadFilesForListing(listingId: number | string, files: FileList | File[]): Promise<void>;
  uploadOneMessageImage(file: File): Promise<unknown>;
  uploadOneMessageImage(conversationId: number | string | null, file: File): Promise<unknown>;
  listingImageCache: Map<unknown, unknown>;
  listingImageInFlight: Map<unknown, Promise<unknown>>;
  uploadBase64Image(data: string, options?: Base64UploadOptions): Promise<boolean>;
}

export declare function createUploadsService(options: CreateUploadsServiceOptions): UploadsService;

export interface CoreEnvironmentOptions {
  baseUrl?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  env?: (key: string) => string | undefined;
  pageSize?: number;
  uploadsUtils?: UploadUtilities;
  api?: ApiClient;
}

export interface CoreEnvironment {
  api: ApiClient;
  auth: AuthService;
  listings: ListingsService;
  uploads: UploadsService;
  helpers: {
    normalizeListingsResponse: typeof normalizeListingsResponse;
    asArray: typeof asArray;
    formatCurrency: typeof formatCurrency;
    formatDistance: typeof formatDistance;
    haversineMeters: typeof haversineMeters;
  };
}

export declare function createCoreEnvironment(options?: CoreEnvironmentOptions): CoreEnvironment;

export interface InstallNativeBindingsOptions extends CoreEnvironmentOptions {
  expose?: boolean;
  logger?: { log: (message: string) => void };
}

export declare function installNativeBindings(options?: InstallNativeBindingsOptions): CoreEnvironment;

declare const _default: {
  createApiClient: typeof createApiClient;
  formatCurrency: typeof formatCurrency;
  formatDistance: typeof formatDistance;
  haversineMeters: typeof haversineMeters;
  normalizeListingsResponse: typeof normalizeListingsResponse;
  asArray: typeof asArray;
  createAuthService: typeof createAuthService;
  createListingsService: typeof createListingsService;
  createUploadsService: typeof createUploadsService;
  createCoreEnvironment: typeof createCoreEnvironment;
  installNativeBindings: typeof installNativeBindings;
};

export default _default;
