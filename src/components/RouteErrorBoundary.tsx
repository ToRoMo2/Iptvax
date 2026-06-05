import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Libellé du bouton de réessai (i18n géré côté appelant). */
  retryLabel: string;
  /** Message affiché à l'utilisateur. */
  message: string;
}

interface State {
  hasError: boolean;
}

/**
 * Filet de sécurité autour des routes lazy. Sans error boundary, l'échec de
 * chargement d'un chunk (réseau coupé, import rejeté) lance une erreur pendant
 * le rendu que React 18 propage jusqu'à la racine → l'app entière se démonte
 * (écran noir), ce qui se ressent comme « l'onglet ne fait rien, il faut
 * relancer l'app ».
 *
 * Ici on intercepte l'erreur et on propose un réessai : `reset()` recharge la
 * page (le plus fiable pour repartir d'un manifeste de chunks propre — le retry
 * de `lazyWithRetry` a déjà absorbé les échecs transitoires en amont).
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Log volontaire et préfixé pour le diagnostic (cf. §V — debug préfixé).
    console.error('[RouteErrorBoundary] chunk/route load failed:', error);
  }

  private reset = () => {
    // Rechargement complet : repart sur le manifeste de chunks à jour et vide
    // l'état lazy rejeté en cache. Plus fiable qu'un simple setState (la
    // promesse lazy resterait rejetée).
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading-screen">
          <span>{this.props.message}</span>
          <button className="btn btn-primary" onClick={this.reset}>
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
