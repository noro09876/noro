import type { Article, Conversation, SupportSettings, Ticket } from '../logic/types';
import { DEFAULT_SETTINGS } from '../logic/demoKb';

export interface SupportState {
  articles: Article[];
  settings: SupportSettings;
  conversations: Conversation[];
  activeId: string | null;
  tickets: Ticket[];
  source: { name: string; at: number; demo: boolean } | null;
}

export const INITIAL: SupportState = {
  articles: [],
  settings: DEFAULT_SETTINGS,
  conversations: [],
  activeId: null,
  tickets: [],
  source: null,
};

export type SetSupport = (fn: (s: SupportState) => SupportState) => void;
