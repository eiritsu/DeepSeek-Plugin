/** SkillHub skill-library copy. */

export const zh = {
  trigger: '技能库', title: '技能库', subtitle: '从 SkillHub 浏览、搜索和下载可复用的 AI 技能。', close: '关闭技能库',
  installed: '已安装', review: '审查安装', discovery: '社区发现', logs: '操作日志', installedEmpty: '尚未发现已安装的技能。下载的 SkillHub 文件需要导入后才会显示在这里。', reviewEmpty: '技能来源审查和导入将在桌面技能运行时接入。', logsEmpty: '暂无技能操作记录。', skillSort: '技能排序', sourceSkillHub: 'SkillHub',
  skills: '全部技能', packages: '技能包', search: '搜索', searchSkills: '搜索技能名称、描述或关键词…', searchPackages: '搜索技能包…',
  allSources: '所有来源', officialSource: '官方来源', communitySource: '社区来源', apiKeyFilter: 'API Key 筛选', apiKeyAll: '不限 API Key', apiKeyNone: '无需 API Key', apiKeyRequired: '需要 API Key',
  sortTrending: '近期飙升',
  sortScore: '全部', sortDownloads: '下载量', sortNewest: '最近上新', allCategories: '所有场景', loading: '正在读取 SkillHub…',
  loadingMore: '正在预加载下一页…', loadMore: '加载更多', allLoaded: '已加载全部结果', empty: '没有匹配的结果。',
  open: '打开 SkillHub', download: '下载', downloading: '准备下载…', downloads: '{count} 次下载', stars: '{count} Star',
  packageSkills: '{count} 项技能', source: '来源 {source}', page: '第 {page} 页', previous: '上一页', next: '下一页',
  failed: '无法读取 SkillHub：{message}',
} satisfies Record<string, string>

export type SkillLibraryLocaleKey = keyof typeof zh

export const en = {
  trigger: 'Skill library', title: 'Skill library', subtitle: 'Browse, search, and download reusable AI skills from SkillHub.', close: 'Close skill library',
  installed: 'Installed', review: 'Review & install', discovery: 'Community discovery', logs: 'Operation log', installedEmpty: 'No installed skills were found. Downloaded SkillHub files appear here after import.', reviewEmpty: 'Skill source review and import will connect to the desktop skill runtime.', logsEmpty: 'No skill operations have been recorded.', skillSort: 'Skill sorting', sourceSkillHub: 'SkillHub',
  skills: 'All skills', packages: 'Skill packages', search: 'Search', searchSkills: 'Search skill names, descriptions, or keywords…', searchPackages: 'Search skill packages…',
  allSources: 'All sources', officialSource: 'Official', communitySource: 'Community', apiKeyFilter: 'API Key filter', apiKeyAll: 'Any API Key', apiKeyNone: 'No API Key', apiKeyRequired: 'Requires API Key',
  sortTrending: 'Trending',
  sortScore: 'All', sortDownloads: 'Downloads', sortNewest: 'Newest', allCategories: 'All scenes', loading: 'Loading SkillHub…',
  loadingMore: 'Preloading the next page…', loadMore: 'Load more', allLoaded: 'All results loaded', empty: 'No matching results.',
  open: 'Open SkillHub', download: 'Download', downloading: 'Preparing download…', downloads: '{count} downloads', stars: '{count} stars',
  packageSkills: '{count} skills', source: 'Source {source}', page: 'Page {page}', previous: 'Previous', next: 'Next',
  failed: 'Unable to read SkillHub: {message}',
} satisfies Record<SkillLibraryLocaleKey, string>
