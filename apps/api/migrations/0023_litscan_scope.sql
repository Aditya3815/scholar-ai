-- Where a literature scan searches (docs/design/litscan-review.md): 'all', the regular sources, or 'india', only Indian sources (DOAJ journals published in India, Shodhganga theses
-- through OpenAlex, papers by authors at Indian institutions; src/search/india.ts). Chosen by the person before the scan starts; the scans made before this are 'all'.
ALTER TABLE litscans ADD COLUMN scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'india'));
