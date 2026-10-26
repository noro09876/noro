import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearProductData } from '../../lib/storage';
import { Icon } from '../ui/Icon';

interface Props {
  product: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Shows the real error and offers to reset local data instead of a blank screen. */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.product}]`, error, info.componentStack);
  }

  reset = async () => {
    await clearProductData(this.props.product);
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;
    const chunk = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className="app" role="alert">
        <div className="empty">
          <div className="empty__icon" style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}>
            <Icon name="alertCircle" />
          </div>
          <div className="empty__title">{chunk ? 'Не удалось загрузить приложение' : 'В приложении произошла ошибка'}</div>
          <div className="empty__text">
            {chunk
              ? 'Похоже, прервалось соединение или сайт обновился. Обновите страницу.'
              : 'Возможно, сохранённые данные повреждены. Можно сбросить данные этого продукта в браузере и начать заново.'}
            <br />
            <code style={{ fontSize: '0.72rem' }}>{this.state.error.message.slice(0, 200)}</code>
          </div>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => window.location.reload()}>
              <Icon name="refresh" /> Обновить страницу
            </button>
            {!chunk ? (
              <button type="button" className="btn btn--sm" onClick={() => void this.reset()}>
                <Icon name="trash" /> Сбросить данные продукта
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
