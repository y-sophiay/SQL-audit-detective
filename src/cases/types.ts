export interface ConceptCard {
  title: string;
  body: string[];
  example: string;
}

export interface CaseDef {
  id: number;
  title: string;
  /** one-line teaser shown on the case board */
  tagline: string;
  /** 1 = Beginner … 4 = Finale, 5 = Follow-up (more query techniques), 6 = Hands-on (changing data) */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * 'query' (default): the player's last SELECT is compared with the planted answer.
   * 'fix': the player's script changes data inside a transaction that is always rolled back; the `verify` query then reads
   * the state the script left behind and that state is compared with the expected one.
   */
  kind?: 'query' | 'fix';
  /** fix cases: SQL that describes the final state, returning one text column named `answerColumn` ('state') */
  verify?: string;
  /** fix cases: shown when the check query itself fails (for example the table was never created) */
  verifyHelp?: string;
  brief: string[];
  task: string;
  /** the result set must contain a column with exactly this name */
  answerColumn: string;
  skills: string[];
  hints: [string, string, string];
  concept: ConceptCard;
  pitfalls: string[];
  /** reference solution — also the executable specification verified by tests */
  solution: string;
  solutionNotes: string;
  /**
   * feedback shown when the player's extra rows overlap a decoy group (keyed by Decoy.key).
   * The special keys '*missing' and '*extra' are used for fix cases when expected state is absent / unexpected state is present.
   */
  decoyMessages: Record<string, string>;
  starter: string;
  /** cases that must be solved before this one unlocks (count of other solved cases) */
  unlockAfterSolved?: number;
}
