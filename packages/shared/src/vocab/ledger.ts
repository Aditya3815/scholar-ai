/**
 * The limits of the turn ledger, the words both sides read it by (design of 6 Nov 2026, page 7; untangle F4, bug B20): the browser builds what it sends with them and the server reads it again with the same numbers (decision 15:
 * the browser's), so the server's comment that "the browser applies the same caps" is true. Imports nothing.
 */

/** The most characters of the person's words, of the standalone question and of a reply that a turn keeps. */
export const LEDGER_USER_CHARS = 300;
export const LEDGER_STANDALONE_CHARS = 300;
export const LEDGER_REPLY_CHARS = 300;
/** The most characters of a paper's title and of its first author's family name. */
export const LEDGER_TITLE_CHARS = 200;
export const LEDGER_AUTHOR_CHARS = 60;
/** The papers of a turn, numbered as its cards were. */
export const LEDGER_PAPERS = 10;
/** What is sent: the six latest turns whole, older ones only as their standalone question; a visitor's ledger is only the three latest. */
export const LEDGER_FULL_TURNS = 6;
export const LEDGER_VISITOR_TURNS = 3;
