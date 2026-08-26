/** Native desktop plugin manager exposed at document start by WKWebView. */

/** One installed dependency in the Web profile. */
export interface InstalledPlugin {
  readonly name: string
  readonly displayName: string
  readonly version: string
  readonly latestVersion?: string
  readonly removable: boolean
}

/** One persistent desktop plugin-operation record. */
export interface PluginAuditRecord {
  readonly id: string
  readonly timestamp: string
  readonly action: string
  readonly subject: string
  readonly status: 'success' | 'failure' | 'review'
  readonly message: string
}

/** Structural class assigned by native source inspection. */
export type PluginCategory = 'profile-bundle' | 'needs-adapter' | 'external-project' | 'blocked'

/** One repository discovered from GitHub's dsh-plugin topic. */
export interface CommunityPlugin {
  readonly repository: string
  readonly description?: string
  readonly stars: number
  readonly language?: string
  readonly updatedAt: string
  readonly htmlUrl: string
  readonly category: PluginCategory
  readonly installable: boolean
}

/** One discovery-only entry projected by the third-party community catalog. */
export interface ThirdPartyPlugin {
  readonly id: string
  readonly name: string
  readonly repository: string
  readonly englishDescription: string
  readonly chineseDescription: string
  readonly stars: number
  readonly categoryId: string
  readonly detailUrl: string
  readonly repositoryUrl: string
}

/** One category reported by the third-party discovery catalog. */
export interface ThirdPartyCategory {
  readonly id: string
  readonly englishName: string
  readonly chineseName: string
  readonly count: number
}

/** Sorts supported by the third-party catalog API. */
export type ThirdPartySort = 'stars' | 'npmDownloads7d' | 'installs' | 'newest' | 'active'

/** Review result retained natively until one installation consumes it. */
export interface PluginReviewReport {
  readonly reviewId?: string
  readonly source: string
  readonly kind: 'npm' | 'github' | 'local'
  readonly subject: string
  readonly category: PluginCategory
  readonly installable: boolean
  readonly requiresForceInstall: boolean
  readonly packageName?: string
  readonly findings: readonly string[]
  readonly risks: readonly string[]
  readonly expiresAt: string
}

/** Operations accepted by the native bridge. */
export type PluginBridgeRequest =
  | { readonly action: 'list' }
  | { readonly action: 'logs' }
  | {
    readonly action: 'catalog'
    readonly page: number
    readonly pageSize: number
    readonly query: string
  }
  | {
    readonly action: 'thirdPartyCatalog'
    readonly page: number
    readonly pageSize: number
    readonly query: string
    readonly category: string
    readonly sort: ThirdPartySort
  }
  | { readonly action: 'review'; readonly source: string }
  | { readonly action: 'reviewUpdate'; readonly package: string }
  | { readonly action: 'selectDirectory' }
  | { readonly action: 'reviewRepository'; readonly repository: string }
  | { readonly action: 'reviewThirdParty'; readonly id: string }
  | { readonly action: 'install'; readonly reviewId: string; readonly force: boolean }
  | { readonly action: 'cancelReview'; readonly reviewId: string }
  | { readonly action: 'remove'; readonly package: string }

/** Reply map for each native operation. */
export interface PluginBridgeReplies {
  readonly list: { readonly plugins: readonly InstalledPlugin[] }
  readonly logs: { readonly records: readonly PluginAuditRecord[] }
  readonly catalog: {
    readonly plugins: readonly CommunityPlugin[]
    readonly hasMore: boolean
  }
  readonly thirdPartyCatalog: {
    readonly plugins: readonly ThirdPartyPlugin[]
    readonly hasMore: boolean
    readonly total: number
    readonly catalogTotal: number
    readonly categories: readonly ThirdPartyCategory[]
  }
  readonly review: { readonly report: PluginReviewReport }
  readonly reviewUpdate: { readonly report: PluginReviewReport }
  readonly selectDirectory: { readonly path?: string }
  readonly reviewRepository: { readonly report: PluginReviewReport }
  readonly reviewThirdParty: { readonly report: PluginReviewReport }
  readonly install: { readonly ok: true }
  readonly cancelReview: { readonly ok: true }
  readonly remove: { readonly ok: true }
}

/** Promise-returning native bridge; unavailable in a normal browser. */
export interface DesktopPluginBridge {
  request<K extends PluginBridgeRequest['action']>(
    request: Extract<PluginBridgeRequest, { action: K }>,
  ): Promise<PluginBridgeReplies[K]>
}

declare global {
  interface Window {
    /** Installed only by the macOS desktop shell on a main-frame loopback page. */
    dshDesktopPluginBridge?: DesktopPluginBridge
  }
}
