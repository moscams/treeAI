import Dexie, { Table } from 'dexie';
import { Session, Model, Folder } from '../types';

class TreeChatDatabase extends Dexie {
  sessions!: Table<Session, string>;
  models!: Table<Model, string>;
  folders!: Table<Folder, string>;

  constructor() {
    super('TreeChatDatabase');
    this.version(1).stores({
      sessions: 'id, title, createdAt, updatedAt',
      models: 'id, name'
    });
    // v2：新增文件夹表。Dexie 会保留 v1 已有的表，只补这一张。
    // 不写迁移是因为旧的 session 没有 folderId，读出来就是 undefined = 未分类。
    this.version(2).stores({
      folders: 'id, name'
    });
  }

  async getAllSessions(): Promise<Session[]> {
    return this.sessions.toArray();
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async saveSession(session: Session): Promise<void> {
    await this.sessions.put(session);
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessions.delete(id);
  }

  async searchSessions(query: string): Promise<Session[]> {
    return this.sessions
      .filter(session => 
        session.title.toLowerCase().includes(query.toLowerCase())
      )
      .toArray();
  }

  async getAllModels(): Promise<Model[]> {
    return this.models.toArray();
  }

  async saveModel(model: Model): Promise<void> {
    await this.models.put(model);
  }

  async deleteModel(id: string): Promise<void> {
    await this.models.delete(id);
  }

  async getModel(id: string): Promise<Model | undefined> {
    return this.models.get(id);
  }

  async getAllFolders(): Promise<Folder[]> {
    return this.folders.toArray();
  }

  async saveFolder(folder: Folder): Promise<void> {
    await this.folders.put(folder);
  }

  async deleteFolder(id: string): Promise<void> {
    await this.folders.delete(id);
  }
}

const db = new TreeChatDatabase();
export default db;
