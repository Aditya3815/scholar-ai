import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ROLE_LABEL, type SharedPaper } from "@scholar/shared";
import { fetchSharedWithMe, leaveShared } from "../../lib/share";
import { toast } from "../../lib/toast";

/**
 * "Shared with me" in My Workspace (docs/design/paper-share.md, 4): the papers other people shared with this account, with the owner's name, the title and the role. A chunk of its own,
 * fetched only when the list of papers says some were shared (never while sharing is off). Leave takes one off the list.
 */
export function SharedWithMe({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<SharedPaper[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetchSharedWithMe().then((r) => setItems(r.items), () => setError(true));
  }, []);
  if (error) return <p className="notes-error" role="alert">Papers shared with you could not be loaded.</p>;
  if (!items || items.length === 0) return null;
  return (
    <section className="papers-list shared-list" aria-labelledby="shared-h">
      <div className="papers-list-head">
        <h2 id="shared-h" className="papers-h2">
          <Users size={16} aria-hidden="true" /> Shared with me
        </h2>
      </div>
      <ul className="shared-items" aria-label="Papers shared with you">
        {items.map((p) => (
          <li key={p.docId} className="card shared-item">
            <button type="button" className="shared-open" onClick={() => onOpen(p.docId)}>
              <span className="shared-title">{p.title}</span>
              <span className="shared-meta">
                {p.ownerName ?? "Someone"} · {ROLE_LABEL[p.role]}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Leave “${p.title}”`}
              onClick={() =>
                void leaveShared(p.docId).then(
                  () => {
                    setItems((xs) => (xs ?? []).filter((x) => x.docId !== p.docId));
                    toast(`You left “${p.title}”`);
                  },
                  () => toast("That did not work. Please try again."),
                )
              }
            >
              Leave
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
