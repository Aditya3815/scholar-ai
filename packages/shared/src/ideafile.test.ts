import { describe, expect, it } from "vitest";
import { docxXmlToText, ideaFileKind, texToText, tidyText } from "@scholar/shared";

describe("ideaFileKind", () => {
  it("knows the formats we read, whatever the case, and nothing else", () => {
    expect(ideaFileKind("Idea.PDF")).toBe("pdf");
    expect(ideaFileKind("note.md")).toBe("markdown");
    expect(ideaFileKind("note.markdown")).toBe("markdown");
    expect(ideaFileKind("paper.tex")).toBe("latex");
    expect(ideaFileKind("my idea.docx")).toBe("docx");
    expect(ideaFileKind("a.txt")).toBe("text");
    expect(ideaFileKind("old.doc")).toBeNull();
    expect(ideaFileKind("scan.png")).toBeNull();
    expect(ideaFileKind("noextension")).toBeNull();
  });
});

describe("docxXmlToText", () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Low-cost glaucoma screening</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">We use a </w:t></w:r><w:r><w:t>phone camera &amp; a CNN</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>in clinics.</w:t></w:r></w:p>
    <w:p><w:r><w:delText>deleted words</w:delText></w:r></w:p>
    <w:p></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell one</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  it("gives one line per paragraph, decodes entities, skips deleted text and empty paragraphs", () => {
    expect(docxXmlToText(xml)).toBe("Low-cost glaucoma screening\nWe use a phone camera & a CNN in clinics.\ncell one");
  });
  it("copes with nothing", () => {
    expect(docxXmlToText("")).toBe("");
  });
});

describe("texToText", () => {
  const tex = String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Graph Networks for \emph{Invoice} Fraud}
\author{Someone}
% a comment that must not appear
\begin{document}
\maketitle
\begin{abstract}
We detect fraud in small-bank invoices with graph neural networks \cite{kipf2017}. Accuracy is 95\% on public data.
\end{abstract}
\section{Introduction}
Fraud costs $x^2$ dollars, and \textbf{early} detection matters~\cite{a,b}.
\begin{equation}
 E = mc^2
\end{equation}
\begin{figure}\includegraphics{a.png}\caption{A figure}\end{figure}
\subsection{Method}
\begin{itemize}\item Build a graph \item Train a model\end{itemize}
\begin{thebibliography}{9}\bibitem{a} A. Author. Hidden. \end{thebibliography}
\end{document}
trailing junk`;
  const out = texToText(tex);

  it("keeps the title, the abstract, the headings and the prose", () => {
    expect(out).toMatch(/^Graph Networks for Invoice Fraud/);
    expect(out).toContain("Abstract");
    expect(out).toContain("We detect fraud in small-bank invoices with graph neural networks");
    expect(out).toContain("Accuracy is 95% on public data.");
    expect(out).toContain("Introduction");
    expect(out).toContain("Method");
    expect(out).toContain("early detection matters");
    expect(out).toContain("- Build a graph");
    expect(out).toContain("- Train a model");
  });

  it("drops comments, formulas, figures, the bibliography, citations and what follows \end{document}", () => {
    expect(out).not.toMatch(/comment|kipf2017|E = mc|figure|A figure|Hidden|trailing junk|\|\{|\}/);
    expect(out).not.toContain("documentclass");
  });

  it("reads a fragment with no preamble, and an escaped percent sign", () => {
    expect(texToText(String.raw`\section{Aim} Reach 50\% coverage. % hidden`)).toBe("Aim\nReach 50% coverage.");
  });
});

describe("tidyText", () => {
  it("normalises line endings and blank runs", () => {
    expect(tidyText("a  \r\n\r\n\r\n\r\nb\t\n")).toBe("a\n\nb");
  });
});
