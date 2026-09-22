import { Session, Model, Folder } from '../types';

/**
 * 会话备份的文件格式。
 *
 * 设计要点：**只有一套 schema，导入端只有一条代码路径**。
 * 「导出全部」和「导出单个会话」的区别仅仅是 sessions 数组里有几条 ——
 * 于是单会话文件可以无缝导入到任何地方，不需要在解析时分支。
 */
export const EXPORT_FORMAT = 'treeai-sessions';
export const EXPORT_VERSION = 1;

export interface SessionExportFile {
  format: string;
  version: number;
  exportedAt: string;
  sessions: Session[];
  /** 可选。单会话导出时不带；全部导出时带上，用于保留节点参数（温度/上限等）。 */
  models?: Model[];
  /** 可选。文件夹表。不带时导入后会话都落在「未分类」。 */
  folders?: Folder[];
}

export interface ParsedExportFile {
  sessions: Session[];
  models: Model[];
  folders: Folder[];
}

export interface ImportResult {
  added: number;
  skipped: number;
}

/**
 * 生成导出内容。
 *
 * apiKey 一律清空 —— 备份文件会在网盘/聊天软件里到处走，不该带着凭据。
 * （顺带一提：Session 本身就不含 key，模型是独立的一张表，所以只有带 models 时才需要处理。）
 */
export function buildExportFile(sessions: Session[], models?: Model[], folders?: Folder[]): SessionExportFile {
  const file: SessionExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
  };

  if (models && models.length > 0) {
    file.models = models.map(m => ({ ...m, apiKey: '' }));
  }

  if (folders && folders.length > 0) {
    file.folders = folders;
  }

  return file;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/** 把会话标题变成能安全落盘的文件名 */
export function safeFileName(text: string, fallback = 'session'): string {
  const cleaned = text
    // Windows / macOS 都不接受这些字符
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return cleaned.slice(0, 60) || fallback;
}

/**
 * 导出单个会话为 JSON 文件。
 *
 * 和「导出全部」共用一套 schema，只是数组里只有一条 ——
 * 这样单会话文件也能直接丢进任何一台设备的导入框。
 */
export function exportSessionToFile(session: Session): void {
  const file = buildExportFile([session]);
  downloadJson(`${safeFileName(session.title)}-session.json`, file);
}

/**
 * 解析导入文件。
 *
 * 刻意返回错误字符串而不是抛异常：调用方可以直接把它丢给用户，
 * 不用再包一层 try/catch，也避免"导入失败但没有任何提示"。
 */
export function parseExportFile(text: string): { data: ParsedExportFile } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: '不是有效的 JSON 文件' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '文件内容不是一个对象' };
  }

  const file = raw as Partial<SessionExportFile>;

  if (file.format !== EXPORT_FORMAT) {
    return { error: '这不是 Tree AI Plus 导出的备份文件' };
  }
  if (typeof file.version !== 'number') {
    return { error: '文件缺少版本号' };
  }
  if (file.version > EXPORT_VERSION) {
    return {
      error: `文件版本 v${file.version} 比当前程序新（最高支持 v${EXPORT_VERSION}），请先升级`
    };
  }
  if (!Array.isArray(file.sessions)) {
    return { error: '文件里没有 sessions 数组' };
  }

  const sessions = file.sessions.filter(isValidSession);
  if (sessions.length === 0) {
    return { error: '文件里没有有效的会话' };
  }

  const models = Array.isArray(file.models) ? file.models.filter(isValidModel) : [];
  const folders = Array.isArray(file.folders) ? file.folders.filter(isValidFolder) : [];

  return { data: { sessions, models, folders } };
}

function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    typeof s.updatedAt === 'string' &&
    Array.isArray(s.nodes)
  );
}

function isValidModel(value: unknown): value is Model {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Model>;
  return (
    typeof m.id === 'string' &&
    typeof m.baseUrl === 'string' &&
    typeof m.modelName === 'string'
  );
}

function isValidFolder(value: unknown): value is Folder {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<Folder>;
  return typeof f.id === 'string' && typeof f.name === 'string';
}
