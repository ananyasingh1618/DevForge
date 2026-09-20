import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "./Button.js";
import { IconAlertTriangle } from "./icons.js";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Catches a render-time exception anywhere below it so one broken page
 * shows a real, safe recovery screen instead of a blank white app — this
 * never hides or fabricates anything; it only stops an unexpected crash
 * from taking down the whole tab. Class component because React's error
 * boundary API (getDerivedStateFromError/componentDidCatch) has no hook
 * equivalent. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
              <IconAlertTriangle className="h-5 w-5 text-danger" />
            </div>
            <h1 className="text-base font-semibold text-text">Something went wrong</h1>
            <p className="text-sm text-text-muted">
              This page hit an unexpected error. Reloading usually fixes it — your data is safe.
            </p>
            <Button type="button" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
