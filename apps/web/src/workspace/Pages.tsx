import { Bookmark, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useLibrary } from "../lib/library";
import { openPreview } from "../lib/preview";
import { LibraryList, libraryNote } from "../components/LibraryDrawer";
import { ProviderButtons } from "../components/ProviderButtons";
import { ReadingForm } from "../components/ReadingControls";
import { SettingsSections } from "../components/SettingsDialog";
import { ThemeSwitch } from "../components/ThemeSwitch";

/** Library as a page of its own (it is a drawer in the old look). Same list, same actions. */
export function LibraryPage() {
  const items = useLibrary();
  const signedIn = !!useAuth().user;
  return (
    <section className="ws-page" aria-labelledby="lib-h">
      <h1 id="lib-h" className="ws-page-h"><Bookmark size={22} aria-hidden="true" /> Library</h1>
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
