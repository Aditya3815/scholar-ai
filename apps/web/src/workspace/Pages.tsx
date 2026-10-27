import { Bookmark, ShieldAlert, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { dismissAlerts, removeSaved, useLibrary, useLibraryAlerts } from "../lib/library";
import { openPreview } from "../lib/preview";
import { LibraryList, libraryNote } from "../components/LibraryDrawer";
import { ProviderButtons } from "../components/ProviderButtons";
import { ReadingForm } from "../components/ReadingControls";
import { SettingsSections } from "../components/SettingsDialog";
import { ThemeSwitch } from "../components/ThemeSwitch";

/**
 * Papers in the library that were retracted after they were saved (the daily re-check found them). The notice stays until it is dismissed or the paper is removed; the paper itself
 * stays in the list, marked as retracted, so it is not cited by mistake.
 */
function RetractionNotices() {
  const alerts = useLibraryAlerts();
  const items = useLibrary();
  if (alerts.length === 0) return null;
  return (
    <section className="lib-alert" role="region" aria-labelledby="lib-alert-h">
      <h2 id="lib-alert-h" className="lib-alert-h">
        <ShieldAlert size={18} aria-hidden="true" /> {alerts.length === 1 ? "A paper you saved has been retracted" : `${alerts.length} papers you saved have been retracted`}
      </h2>
      <p className="lib-alert-p">A journal or publisher withdrew {alerts.length === 1 ? "it" : "them"} after you saved {alerts.length === 1 ? "it" : "them"}. {alerts.length === 1 ? "It stays" : "They stay"} in your library, marked as retracted, so you do not cite {alerts.length === 1 ? "it" : "them"} by mistake. Read the retraction notice first: some papers are retracted for a part of the work only.</p>
      <ul className="lib-alert-list">
        {alerts.map((a) => {
          const paper = items.find((p) => p.id === a.paperId);
          return (
            <li key={a.paperId}>
              {paper ? <button type="button" className="link-btn" onClick={() => openPreview(paper, items)}>{a.title}</button> : <span>{a.title}</span>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSaved(a.paperId)} aria-label={`Remove ${a.title} from library`}>Remove from library</button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissAlerts()}>{alerts.length === 1 ? "Got it" : "Got it, hide these notices"}</button>
    </section>
  );
}

/** Library as a page of its own (it is a drawer in the old look). Same list, same actions. */
export function LibraryPage() {
  const items = useLibrary();
  const signedIn = !!useAuth().user;
  return (
    <section className="ws-page" aria-labelledby="lib-h">
      <h1 id="lib-h" className="ws-page-h"><Bookmark size={22} aria-hidden="true" /> Library</h1>
      <RetractionNotices />
      <p className="ws-page-lead">{libraryNote(signedIn)} A bookmark is a record, not a copy: open it to read the abstract and its checks.</p>
      <div className="ws-library">
        <LibraryList items={items} onOpen={(p) => openPreview(p, items)} />
      </div>
    </section>
  );
}

/** Settings as a page of its own: reading, theme, account, your data (a dialog in the old look). */
export function SettingsPage() {
  const { user, status } = useAuth();
  return (
    <section className="ws-page" aria-labelledby="set-h">
      <h1 id="set-h" className="ws-page-h"><SettingsIcon size={22} aria-hidden="true" /> Settings</h1>
      <p className="ws-page-lead">How things look, how papers are read, and what we hold about you.</p>

      <section className="settings-sec" aria-labelledby="set-look">
        <h2 id="set-look" className="settings-h">Look</h2>
        <p className="settings-p">Auto follows your device. Read is a warm, low-glare theme for long sessions.</p>
        <ThemeSwitch scope="page" />
      </section>

      <section className="settings-sec" aria-labelledby="set-read">
        <h2 id="set-read" className="settings-h">Reading</h2>
        <p className="settings-p">Applies to abstracts, answers and the paper reader. Stored in this browser.</p>
        <ReadingForm heading={false} idPrefix="ws-rc" />
      </section>

      {user ? (
        <SettingsSections idPrefix="ws-set" />
      ) : (
        status === "ready" && (
          <section className="settings-sec" aria-labelledby="set-in">
            <h2 id="set-in" className="settings-h">Account</h2>
            <p className="settings-p">Sign in to see your details, export your data or delete your account.</p>
            <ProviderButtons />
          </section>
        )
      )}
    </section>
  );
}
