export type EventFacts = Record<string, string>;

export type NewsEvent = {
  id: string;
  category: string;
  scope: string;
  importance: number;
  sources: string[];
  facts: EventFacts;
  timestamp: string;
  summary: string;
  microSummary: string;
  details: string;
};
