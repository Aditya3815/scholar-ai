import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/monitoring";

/** If something in the page throws while drawing, show a plain message and a way out instead of a blank screen, and tell us. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" role="alert" style={{ margin: "4rem auto", maxWidth: "32rem" }}>
        <p className="empty-title">Something went wrong</p>
        <p>The page hit a problem. We have been told. Your papers and library are safe; reloading usually fixes it.</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload the page</button>
      </div>
    );
  }
}
