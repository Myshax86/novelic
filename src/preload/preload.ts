import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateChapterInput,
  CreateEventInput,
  CreateNovelInput,
  CreateTimelineInput,
  NovelPayload,
  UpdateChapterInput,
  Timeline,
  UpdateEventInput
} from '../shared/types';

const api = {
  novels: {
    list: () => ipcRenderer.invoke('novels:list'),
    create: (input: CreateNovelInput) => ipcRenderer.invoke('novels:create', input),
    delete: (novelId: string) => ipcRenderer.invoke('novels:delete', novelId),
    getPayload: (novelId: string) => ipcRenderer.invoke('novels:getPayload', novelId)
  },
  chapters: {
    list: (novelId: string) => ipcRenderer.invoke('chapters:list', novelId),
    create: (input: CreateChapterInput) => ipcRenderer.invoke('chapters:create', input),
    update: (input: UpdateChapterInput) => ipcRenderer.invoke('chapters:update', input),
    delete: (chapterId: string) => ipcRenderer.invoke('chapters:delete', chapterId)
  },
  timelines: {
    list: (novelId: string) => ipcRenderer.invoke('timelines:list', novelId),
    create: (input: CreateTimelineInput) => ipcRenderer.invoke('timelines:create', input),
    update: (timeline: Timeline) => ipcRenderer.invoke('timelines:update', timeline),
    delete: (id: string) => ipcRenderer.invoke('timelines:delete', id)
  },
  events: {
    list: (novelId: string) => ipcRenderer.invoke('events:list', novelId),
    create: (input: CreateEventInput) => ipcRenderer.invoke('events:create', input),
    update: (input: UpdateEventInput) => ipcRenderer.invoke('events:update', input),
    delete: (id: string) => ipcRenderer.invoke('events:delete', id),
    getOverlapping: (novelId: string, cursorDate: string, chapterId?: string) =>
      ipcRenderer.invoke('events:getOverlapping', novelId, cursorDate, chapterId)
  },
  state: {
    createSnapshot: (novelId: string, payload: string) =>
      ipcRenderer.invoke('state:createSnapshot', novelId, payload),
    listSnapshots: (novelId: string) => ipcRenderer.invoke('state:listSnapshots', novelId),
    replacePayload: (payload: NovelPayload) => ipcRenderer.invoke('state:replacePayload', payload),
    exportNovelJson: (novelId: string) => ipcRenderer.invoke('state:exportNovelJson', novelId),
    exportTimelineCsv: (novelId: string, timelineId: string) =>
      ipcRenderer.invoke('state:exportTimelineCsv', novelId, timelineId),
    importNovelJson: () => ipcRenderer.invoke('state:importNovelJson')
  }
};

contextBridge.exposeInMainWorld('novelic', api);

declare global {
  interface Window {
    novelic: typeof api;
  }
}

export type PreloadApi = typeof api;
