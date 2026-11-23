import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearAllSavedBooks } from '../utils/bookStorage';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || "Une erreur inattendue s'est produite.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Sonobande ErrorBoundary:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetStorage = async () => {
    try {
      await clearAllSavedBooks();
    } catch {
      // Ignore storage errors during emergency reset
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#ece9e2] px-5 py-10 text-[#1c1e21]">
        <div className="w-full max-w-md rounded-2xl border border-[#cfc9bd] bg-[#f7f5f0] p-6 shadow-sm">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#b93e0e]">
            Sonobande
          </p>
          <h1 className="mt-1 font-display text-xl font-bold text-[#1c1e21]">
            L’affichage a rencontré une erreur
          </h1>
          <p className="mt-2 text-sm text-[#4a4d52]">
            Vous pouvez recharger la page ou réinitialiser le stockage local du navigateur si un livre enregistré était corrompu.
          </p>
          {this.state.errorMessage && (
            <p className="mt-3 rounded-lg border border-[#e0dbd0] bg-white px-3 py-2 font-mono text-xs text-[#6b341b]">
              {this.state.errorMessage}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-[#d9531e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#c24515]"
            >
              Recharger Sonobande
            </button>
            <button
              type="button"
              onClick={() => void this.handleResetStorage()}
              className="rounded-lg border border-[#cfc9bd] bg-white px-4 py-2 text-xs font-medium text-[#25272b] hover:bg-[#f0ede5]"
            >
              Vider le stockage local et recharger
            </button>
          </div>
        </div>
      </div>
    );
  }
}
