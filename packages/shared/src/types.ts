// The shapes the API sends and receives. The journal's own shapes come with their tables (PLAN.md §5).

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin" | "user";
  mode: "server" | "local";
}

export interface LiveEvent {
  topics: string[];
  at: number;
}
