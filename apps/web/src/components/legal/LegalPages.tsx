import { m } from "motion/react";
import { FileWarning } from "lucide-react";
import type { ReactNode } from "react";
import { MAX_DOC_BYTES, MAX_DOCS_PER_USER, MAX_REFERENCES } from "@scholar/shared";
import { easeOut } from "../../lib/motion";
import { LEGAL, LEGAL_COMPLETE } from "../../lib/legal";

/** A detail that is not filled in yet shows as a visible marker, never as an empty gap. */
function Fill({ value, what }: { value: string; what: string }) {
  return value ? <>{value}</> : <mark className="legal-fill">[{what}: to be added]</mark>;
}

function Layout({ title, intro, updated, children }: { title: string; intro: string; updated?: boolean; children: ReactNode }) {
  return (
    <m.article className="legal" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <p className="eyebrow">{LEGAL.product}</p>
      <h1 className="legal-title">{title}</h1>
      <p className="legal-intro">{intro}</p>
      {!LEGAL_COMPLETE && (
        <p className="legal-draft" role="note">
          <FileWarning size={18} aria-hidden="true" />
          <span>
            <strong>Draft.</strong> This text describes what the service really does today, but it has not been read by a lawyer yet and some contact details are still to be added (shown like
            this: <mark className="legal-fill">[to be added]</mark>). It is not yet a binding agreement.
          </span>
        </p>
      )}
      {updated && LEGAL.effective && <p className="legal-date">In force since {LEGAL.effective}.</p>}
      <div className="legal-body">{children}</div>
    </m.article>
  );
}

const Contact = () => (
  <p>
    <Fill value={LEGAL.entity} what="who runs the service" />
    <br />
    <Fill value={LEGAL.address} what="postal address" />
    <br />
    E-mail: <Fill value={LEGAL.contactEmail} what="contact e-mail" />
  </p>
);

/* ---------------------------------------------------------------- how we verify */

export function HowWeVerifyPage() {
  return (
    <Layout title="How we verify" intro="What “verified” means in this service, how it is checked, and where it can be wrong. Every number here comes from our own tests and will move; the tests run on every change and every week.">
      <h2>The one rule</h2>
      <p>
        <strong>No citation is ever written by AI.</strong> Every paper you see is a record we fetched from OpenAlex, Semantic Scholar, Crossref or PubMed. An AI model may read your text and help find papers, but it never
        produces a reference.
      </p>

      <h2>Search results</h2>
      <ul>
        <li>Four services are searched at once and duplicates are merged by DOI.</li>
        <li>Every DOI is checked: does it exist, and does the registered title agree with the record? A DOI that fails is removed from the result, so you cannot cite something that is not there.</li>
        <li>Every DOI is checked against Retraction Watch data (through Crossref), and retracted papers are marked clearly.</li>
      </ul>

      <h2>The Reference Verifier</h2>
      <p>For each reference you paste (up to {MAX_REFERENCES} at a time), we look for a real record and compare it. There is no AI in this step; it is fixed rules you can read:</p>
      <ul>
        <li><strong>Verified</strong>: the record&apos;s title is covered by your reference, at least one of author or year matches, and nothing contradicts it.</li>
        <li><strong>Details don&apos;t match</strong>: a real paper with this title (or this DOI) exists but the authors or year differ. This is the classic pattern of an AI-made reference.</li>
        <li><strong>Not found</strong>: nothing in Crossref or OpenAlex matches. This can mean the reference is invented, or that it is a book, thesis, report, web page or regional journal that these databases do not index. We say which, when we can.</li>
        <li><strong>Could not check</strong>: a database was unreachable. This is never shown as verified or as not found.</li>
      </ul>
      <p>How it did in our tests:</p>
      <ul>
        <li>100 real references in five styles: <strong>98 verified</strong>.</li>
        <li>60 real references drawn at random, half from Indian institutions: <strong>57 verified</strong> (95%).</li>
        <li>70 invented references (invented papers, real titles with invented authors, real papers with the year moved, DOIs that do not exist): <strong>0 verified</strong>.</li>
        <li>175 references taken from five real PDFs: <strong>78% verified</strong>. Most of the rest were books, reports, web pages and Wikipedia, which are not in these databases.</li>
      </ul>
      <p>A reference that is not verified is not necessarily wrong. A reference that is verified has a real record behind it, but you should still read the paper you cite.</p>

      <h2>Questions about your paper</h2>
      <ul>
        <li>The text of your PDF is split into passages. For your question we pick the most relevant ones and give only those to the AI.</li>
        <li>The AI must answer from those passages and quote them. <strong>We then check that each quote really is in your paper</strong>, word for word (ignoring spacing and punctuation). A quote that is not there is dropped, and the answer is marked as unverified.</li>
        <li>If the paper does not cover the question, it says so instead of guessing.</li>
        <li>Click a source to jump to the page and see it highlighted.</li>
      </ul>
      <p>In our weekly test (35 questions on five papers, one in Hindi each): 24 of 24 answerable questions answered correctly, 10 of 10 unanswerable ones declined, and every source verified. A model can still misread a passage that it quotes correctly, so use the highlighted source, not the sentence alone.</p>

      <h2>Idea Check</h2>
      <ul>
        <li>You approve the exact search that is sent (it never contains your idea or your file) before anything is searched.</li>
        <li>We list the closest papers and every search that was run, including any that failed.</li>
        <li><strong>We do not say whether your idea is new.</strong> Research on AI judges shows they are poor at that. Not finding a paper means it is not in these databases; it does not mean it does not exist. Theses, many regional journals and unpublished work are mostly missing.</li>
      </ul>

      <h2>Where it can go wrong</h2>
      <ul>
        <li>The databases have mistakes (wrong authors, wrong years, duplicate records). We show what they say.</li>
        <li>Scanned papers (PDFs made of page pictures) are read by two AI models that check each other. Where they agree the page is used; where they do not, the page is marked as not read reliably and left out of answers. Two models can still make the same mistake, so check numbers and names on the page. Highlighting and notes need selectable text, which a scan does not have. Handwriting and most scripts other than English and Devanagari are not supported.</li>
        <li>A reprint can have a later year than the original, which we report as a year difference.</li>
        <li>Found a mistake? Use “Report a problem” on the answer, the reference or the idea search. It goes straight to us and we use it to improve the tests.</li>
      </ul>
    </Layout>
  );
}

/* ---------------------------------------------------------------- privacy */

export function PrivacyPage() {
  return (
    <Layout title="Privacy policy" intro="What we keep about you and your work, who else sees it, and how to delete it. In plain words." updated>
      <h2>Who we are</h2>
      <p>{LEGAL.product} is run by:</p>
      <Contact />
      <p>
        For India&apos;s Digital Personal Data Protection Act, 2023, we are the “data fiduciary” for the information described here. Complaints about personal data go to our grievance contact:{" "}
        <Fill value={LEGAL.grievanceName} what="grievance officer's name" />, <Fill value={LEGAL.grievanceEmail} what="grievance e-mail" />.
      </p>

      <h2>What we keep</h2>
      <table className="legal-table">
        <caption className="sr-only">What is kept, why, and for how long</caption>
        <thead>
          <tr><th scope="col">What</th><th scope="col">Why</th><th scope="col">How long</th></tr>
        </thead>
        <tbody>
          <tr><td>Your name, e-mail address (Google) or ORCID iD, and profile picture link, from the account you sign in with. We never see a password.</td><td>To sign you in and show who you are</td><td>Until you delete your account</td></tr>
          <tr><td>A sign-in session (a cookie; only a scrambled form is stored)</td><td>To keep you signed in</td><td>30 days, or until you sign out</td></tr>
          <tr><td>Your library: papers you saved from search results (public information about published papers)</td><td>So you can find them again</td><td>Until you remove them or delete your account</td></tr>
          <tr><td>Papers you upload: the PDF, the text read from it, a searchable index of that text, what we found in it (title, DOI, references), and your questions and the answers</td><td>To let you read and ask questions about your paper</td><td>Until you delete the paper or your account. Up to {MAX_DOCS_PER_USER} papers of {MAX_DOC_BYTES / 1024 / 1024} MB each</td></tr>
          <tr><td>Your ideas in Idea Check</td><td>—</td><td><strong>Not stored.</strong> The text is read, a search is planned, and nothing is kept</td></tr>
          <tr><td>Reports you send with “Report a problem”, with what the page says it sends</td><td>To fix mistakes and improve the tests</td><td>One year, or until you delete your account</td></tr>
          <tr><td>How much AI you used (a count of tokens, the model, whether it worked), tied to your account but never the text</td><td>To keep use fair and to see what the service costs</td><td>90 days</td></tr>
          <tr><td>Technical logs: the page asked for, the result and how long it took. No page content, no questions, no ideas</td><td>To find and fix faults</td><td>Short-lived, as kept by our hosting service</td></tr>
          <tr><td>A short note that you read the privacy text, and which version</td><td>So we can show we asked</td><td>Until you delete your account</td></tr>
          <tr><td>Errors from the app (the kind of error, a shortened message, where in the code, which page), sent to an error-tracking service</td><td>To find bugs. Anything that looks like an e-mail address, a link or an id is removed first, and no one&apos;s name, address or text is included</td><td>For the period that service keeps them</td></tr>
        </tbody>
      </table>
      <p>We do not use advertising or analytics cookies and we do not track you across other sites. The one cookie is the sign-in session. Your reading preferences (theme, text size) stay in your browser.</p>

      <h2>Your papers and ideas</h2>
      <ul>
        <li>They are <strong>private to your account</strong>. Other users cannot see them. We do not read them as part of running the service; the people who run it can reach the database in order to fix a fault, but the admin page shows numbers only.</li>
        <li>To answer a question or plan a search, the relevant text is sent to an AI model run by <strong>Cloudflare (Workers AI)</strong>. For a scanned paper, a picture of each page is sent to the same service to be read; the picture is not stored by us, and the text that was read is kept like any other text of your paper. We use only AI services whose terms say they do not keep or train on what we send. <strong>Your papers, questions and ideas are never sent to any other AI service</strong>, and are never used to train any AI.</li>
        <li>Idea Check sends the search you approved, and only that, to OpenAlex and Semantic Scholar. They can see those words and our service&apos;s address, not you or your file. Look at the search before you send it; remove anything you would rather not share.</li>
        <li>The references you verify are sent as text to Crossref and OpenAlex to find the record. We keep the verdict (not your text) for up to a day so a repeat is fast.</li>
      </ul>

      <h2>Who else handles data (our service providers)</h2>
      <ul>
        <li><strong>Cloudflare</strong>: runs the service, stores the database and files, and runs the AI that reads your text. Data may be processed in data centres outside India.</li>
        <li><strong>Google</strong> and <strong>ORCID</strong>: only when you choose to sign in with them.</li>
        <li><strong>OpenAlex, Semantic Scholar, Crossref, PubMed, doi.org</strong>: public databases we ask about papers. See above for what they receive.</li>
        <li><strong>Sentry</strong>: receives the error reports described in the table.</li>
        <li>We do not sell personal data and do not share it for advertising.</li>
      </ul>

      <h2>Your rights, and how to use them</h2>
      <ul>
        <li><strong>See what we hold</strong>: Settings and data, then Export my data. You get everything about your account as one file.</li>
        <li><strong>Delete</strong>: delete one paper from its card, or your whole account in Settings and data. This removes your papers, their files, your questions, your library and your reports straight away. Copies in our hosting service&apos;s database backups can last up to 30 days more, and then expire. If we ever have to restore a backup, an account you deleted would come back with it; so for 35 days after you delete your account we keep one random account number (no name, e-mail or paper), only so that we can erase it again after a restore.</li>
        <li><strong>Correct</strong>: your name comes from Google or ORCID; change it there and it updates next time you sign in. For anything else, write to us.</li>
        <li><strong>Complain</strong>: to our grievance contact above. If you are not satisfied, India&apos;s Data Protection Board is the next step.</li>
        <li><strong>Withdraw</strong>: you can stop at any time. Deleting your account withdraws everything.</li>
      </ul>

      <h2>Children</h2>
      <p>The service is for researchers, students and teachers aged 18 and over. We do not knowingly collect data from children.</p>

      <h2>Changes</h2>
      <p>If this text changes in a way that matters, we will ask you to read it again before you upload a paper or check an idea, and we will say what changed.</p>

      <h2>Contact</h2>
      <Contact />
    </Layout>
  );
}

/* ---------------------------------------------------------------- terms */

export function TermsPage() {
  return (
    <Layout title="Terms of use" intro="The rules for using the service, in plain words." updated>
      <h2>What the service is</h2>
      <p>
        {LEGAL.product} helps researchers find papers, check references, ask questions about their own papers and see what already exists near an idea. It is a tool for your own judgement. It does not give
        legal, medical, academic-integrity or publishing advice.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You sign in with Google or ORCID. Keep your account to yourself, and tell us if you think someone else is using it.</li>
        <li>You must be 18 or over.</li>
        <li>You can delete your account at any time in Settings and data.</li>
      </ul>

      <h2>Your content</h2>
      <ul>
        <li>What you upload and write stays yours. You give us only the permission we need to run the service for you: store it, read it, send the relevant text to the AI service that answers, and show you the result.</li>
        <li>Upload only what you have the right to upload. Do not upload other people&apos;s confidential material, or anything you may not copy. Your uploads are for your own use and are not shared.</li>
        <li>Do not use the service to break the law, to harm others, to probe or overload it, or to collect its data in bulk. Limits (for example on papers, questions per day and searches per minute) protect everyone.</li>
      </ul>

      <h2>Accuracy: please read this</h2>
      <ul>
        <li>The results can be wrong. Databases have errors, PDFs are read imperfectly, and AI models can misread a passage even when they quote it correctly.</li>
        <li>“Verified” means a matching record was found; it does not mean the paper is good or that your claim about it is right. “Not found” does not mean a paper does not exist.</li>
        <li>You are responsible for what you cite, submit or publish. Check the sources yourself. See <a href="/how-we-verify">How we verify</a> for what each label means.</li>
      </ul>

      <h2>Third-party services and open data</h2>
      <p>Paper information comes from OpenAlex, Semantic Scholar, Crossref and PubMed, and retraction data from Retraction Watch through Crossref. Their data belongs to them and is used under their terms. They can change or stop at any time, and then parts of the service can be slow or unavailable.</p>

      <h2>The service itself</h2>
      <ul>
        <li>We work to keep it running but it is provided as it is, without a promise of being available or error-free. Features may change.</li>
        <li>To the extent the law allows, we are not liable for losses that come from relying on results, or from the service being unavailable. Nothing here limits any right you have that cannot be limited by law.</li>
        <li>We may suspend an account that breaks these rules, and will say why when we can.</li>
      </ul>

      <h2>Changes and law</h2>
      <p>We may update these terms and will tell you in the service before a change that matters takes effect. Indian law applies, and the courts of <Fill value={LEGAL.jurisdiction} what="city or state" /> can hear disputes, without taking away any right you have to go to another court under the law.</p>

      <h2>Contact</h2>
      <Contact />
    </Layout>
  );
}
