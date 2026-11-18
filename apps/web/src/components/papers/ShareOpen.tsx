import { useEffect, useState } from "react";
import { SHARE_TOKEN } from "@scholar/shared";
import { markLinkVisit, openLink } from "../../lib/share";

/**
 * A shared paper's link, /s/<token> (docs/design/paper-share.md, 2.3). The token is sent once, in the body of a request (never in an address the server logs), and the server keeps it in a
 * cookie for that paper's requests only; then the page goes to the paper's own address, so the token is no longer in the address bar or the history. The page that serves /s/* is not
 * indexed, not cached, and sends no referrer (public/_headers).
 */
export function ShareOpen({ onOpen }: { onOpen: (docId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = location.pathname.split("/")[2] ?? "";
    if (!SHARE_TOKEN.test(token)) return setError("This link is not complete. Copy it again from the message you were sent.");
    openLink(token).then(
      ({ docId }) => {
        markLinkVisit(docId);
        onOpen(docId);
      },
      (e) => setError(e instanceof Error ? e.message : "This link does not work"),
    );
  }, [onOpen]);
  return (
    <div className="dw dw-center">
      {error ? (
        <div className="empty" role="alert">
          <p className="empty-title">{error}</p>
        </div>
      ) : (
        <p className="empty" role="status">
          Opening the shared paper…
        </p>
      )}
    </div>
  );
}
