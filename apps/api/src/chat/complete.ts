import { OPTIONAL_SOURCES, type SearchResponse } from "@scholar/shared";

/**
 * Did every place that was asked answer? (A place that was not asked, because it is not in this search, is not counted; DOAJ, a supplement that answers from a lane of two requests a
 * second for everyone, is not counted when it alone fails: the reader is then not told the list "may be incomplete" for a source that adds to the four.)
 */
export const searchComplete = (r: Pick<SearchResponse, "providers">): boolean =>
  Object.entries(r.providers).every(([name, p]) => p.ok || OPTIONAL_SOURCES.includes(name));
