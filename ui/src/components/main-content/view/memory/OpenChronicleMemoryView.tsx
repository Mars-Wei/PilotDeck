import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../../utils/api';

type Locale = 'zh' | 'en';

type OpenChronicleStatus = {
  name: string;
  url: string;
  reachable?: boolean;
  health?: string;
  installed?: boolean;
  root?: string;
  configExists?: boolean;
  memoryDirExists?: boolean;
};

type MemoryFile = {
  path: string;
  prefix: string;
  size: number;
  updatedAt: string;
};

type EntryResult = {
  id: string;
  path: string;
  prefix: string;
  timestamp: string;
  tags: string;
  content: string;
};

type CaptureResult = {
  id: string;
  timestamp: string;
  app_name: string;
  window_title: string;
  url: string;
  snippet: string;
};

type SearchKind = 'memory' | 'captures';

const TEXT: Record<Locale, Record<string, string>> = {
  zh: {
    title: '本机记忆',
    subtitle: '本机桌面上下文记忆：当前屏幕、近期活动与持久化 Markdown 记忆。',
    statusReachable: '服务在线',
    statusUnreachable: '服务离线',
    statusInstalled: '已安装',
    statusNotInstalled: '未安装',
    refresh: '刷新',
    notInstalledTitle: '未检测到 OpenChronicle',
    notInstalledHint: '请先在「设置 · MCP」中安装并启动 OpenChronicle 守护进程。',
    today: '今日记忆',
    todayEmpty: '今天还没有记忆条目。',
    search: '搜索',
    searchPlaceholder: '搜索记忆 / 捕获…',
    searchMemory: '记忆',
    searchCaptures: '原始捕获',
    searchEmpty: '没有匹配结果。',
    searchPrompt: '输入关键词开始搜索。',
    dbUnavailable: '搜索索引不可用（index.db 缺失或守护进程尚未建索引）。',
    files: 'Markdown 记忆文件',
    filesEmpty: '暂无记忆文件。',
    back: '返回列表',
    loading: '加载中…',
    error: '加载失败',
  },
  en: {
    title: 'Local Memory',
    subtitle: 'Local desktop-context memory: current screen, recent activity, and durable Markdown memory.',
    statusReachable: 'Online',
    statusUnreachable: 'Offline',
    statusInstalled: 'Installed',
    statusNotInstalled: 'Not installed',
    refresh: 'Refresh',
    notInstalledTitle: 'OpenChronicle not detected',
    notInstalledHint: 'Install and start the OpenChronicle daemon from Settings · MCP first.',
    today: 'Today',
    todayEmpty: 'No memory entries for today yet.',
    search: 'Search',
    searchPlaceholder: 'Search memory / captures…',
    searchMemory: 'Memory',
    searchCaptures: 'Captures',
    searchEmpty: 'No matching results.',
    searchPrompt: 'Type a keyword to search.',
    dbUnavailable: 'Search index unavailable (index.db missing or not yet built).',
    files: 'Markdown memory files',
    filesEmpty: 'No memory files yet.',
    back: 'Back to list',
    loading: 'Loading…',
    error: 'Failed to load',
  },
};

function formatTime(value: string): string {
  if (!value) return '';
  return value.replace('T', ' ').replace(/(\+|-)\d\d:\d\d$/, '').slice(0, 16);
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const CARD = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
const HEADING = 'text-[13px] font-semibold text-neutral-800 dark:text-neutral-100';

export default function OpenChronicleMemoryView({ locale }: { locale: Locale }) {
  const t = TEXT[locale];

  const [status, setStatus] = useState<OpenChronicleStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [today, setToday] = useState<{ available: boolean; content: string } | null>(null);

  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [activeFile, setActiveFile] = useState<{ path: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('memory');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [searched, setSearched] = useState(false);
  const [entryResults, setEntryResults] = useState<EntryResult[]>([]);
  const [captureResults, setCaptureResults] = useState<CaptureResult[]>([]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await authenticatedFetch('/api/openchronicle/status');
      const data = await res.json();
      if (res.ok && data?.status) setStatus(data.status);
    } catch {
      // ignore — banner falls back to "offline"
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/openchronicle/memory/today');
      const data = await res.json();
      if (res.ok) setToday({ available: Boolean(data.available), content: data.content || '' });
    } catch {
      setToday({ available: false, content: '' });
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/openchronicle/memory/files');
      const data = await res.json();
      if (res.ok && Array.isArray(data.files)) setFiles(data.files);
    } catch {
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void loadToday();
    void loadFiles();
  }, [refreshStatus, loadToday, loadFiles]);

  const openFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setActiveFile({ path: filePath, content: '' });
    try {
      const res = await authenticatedFetch(`/api/openchronicle/memory/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setActiveFile({ path: filePath, content: res.ok ? data.content || '' : (data.details || data.error || '') });
    } catch (err) {
      setActiveFile({ path: filePath, content: err instanceof Error ? err.message : String(err) });
    } finally {
      setFileLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (kind: SearchKind, text: string) => {
    if (!text.trim()) {
      setSearched(false);
      setEntryResults([]);
      setCaptureResults([]);
      return;
    }
    setSearchLoading(true);
    setSearched(true);
    try {
      const res = await authenticatedFetch(
        `/api/openchronicle/memory/search?kind=${kind}&q=${encodeURIComponent(text.trim())}`,
      );
      const data = await res.json();
      setSearchAvailable(data.available !== false);
      if (kind === 'captures') {
        setCaptureResults(Array.isArray(data.results) ? data.results : []);
      } else {
        setEntryResults(Array.isArray(data.results) ? data.results : []);
      }
    } catch {
      setSearchAvailable(false);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchKind, query);
  };

  const onChangeKind = (kind: SearchKind) => {
    setSearchKind(kind);
    if (query.trim()) void runSearch(kind, query);
  };

  const reachable = status?.reachable === true;
  const installed = status?.installed === true;

  return (
    <div className="h-full w-full overflow-y-auto bg-neutral-50 px-5 py-5 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {/* Status banner */}
        <div className={CARD}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{t.title}</div>
              <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t.subtitle}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill active={reachable} label={reachable ? t.statusReachable : t.statusUnreachable} />
                <StatusPill active={installed} label={installed ? t.statusInstalled : t.statusNotInstalled} />
                {status?.url ? (
                  <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{status.url}</span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={statusLoading}
              className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {statusLoading ? t.loading : t.refresh}
            </button>
          </div>
        </div>

        {!installed && status ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300">
            <div className="font-semibold">{t.notInstalledTitle}</div>
            <div className="mt-1 leading-5">{t.notInstalledHint}</div>
          </div>
        ) : null}

        {/* Search */}
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <div className={HEADING}>{t.search}</div>
            <div className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
              {(['memory', 'captures'] as SearchKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChangeKind(kind)}
                  className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    searchKind === kind
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {kind === 'memory' ? t.searchMemory : t.searchCaptures}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={onSubmitSearch} className="mt-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
            <button
              type="submit"
              disabled={searchLoading}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {searchLoading ? t.loading : t.search}
            </button>
          </form>
          <div className="mt-3">
            {!searchAvailable ? (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{t.dbUnavailable}</div>
            ) : !searched ? (
              <div className="text-xs text-neutral-400 dark:text-neutral-500">{t.searchPrompt}</div>
            ) : searchKind === 'memory' ? (
              entryResults.length === 0 ? (
                <div className="text-xs text-neutral-500 dark:text-neutral-400">{t.searchEmpty}</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {entryResults.map((r) => (
                    <li key={r.id} className="rounded-md border border-neutral-100 bg-neutral-50 p-2.5 dark:border-neutral-800 dark:bg-neutral-950">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                        <span className="font-mono">{r.path}</span>
                        <span>{formatTime(r.timestamp)}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-neutral-700 dark:text-neutral-200">
                        {r.content}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : captureResults.length === 0 ? (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{t.searchEmpty}</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {captureResults.map((r) => (
                  <li key={r.id} className="rounded-md border border-neutral-100 bg-neutral-50 p-2.5 dark:border-neutral-800 dark:bg-neutral-950">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                      <span className="font-medium text-neutral-500 dark:text-neutral-300">
                        {r.app_name}{r.window_title ? ` · ${r.window_title}` : ''}
                      </span>
                      <span>{formatTime(r.timestamp)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-neutral-700 dark:text-neutral-200">
                      {r.snippet}
                    </div>
                    {r.url ? <div className="mt-1 truncate font-mono text-[11px] text-blue-500">{r.url}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Today */}
        <div className={CARD}>
          <div className={HEADING}>{t.today}</div>
          <div className="mt-2">
            {today === null ? (
              <div className="text-xs text-neutral-400">{t.loading}</div>
            ) : !today.available || !today.content.trim() ? (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{t.todayEmpty}</div>
            ) : (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                {today.content}
              </pre>
            )}
          </div>
        </div>

        {/* Markdown files */}
        <div className={CARD}>
          {activeFile ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-xs text-neutral-600 dark:text-neutral-300">{activeFile.path}</div>
                <button
                  type="button"
                  onClick={() => setActiveFile(null)}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {t.back}
                </button>
              </div>
              <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                {fileLoading ? t.loading : activeFile.content}
              </pre>
            </>
          ) : (
            <>
              <div className={HEADING}>{t.files}</div>
              <div className="mt-2">
                {files.length === 0 ? (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{t.filesEmpty}</div>
                ) : (
                  <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
                    {files.map((f) => (
                      <li key={f.path}>
                        <button
                          type="button"
                          onClick={() => void openFile(f.path)}
                          className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                        >
                          <span className="truncate font-mono text-xs text-neutral-700 dark:text-neutral-200">{f.path}</span>
                          <span className="shrink-0 text-[11px] text-neutral-400">
                            {formatBytes(f.size)} · {f.updatedAt.slice(0, 10)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
          : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
      {label}
    </span>
  );
}
