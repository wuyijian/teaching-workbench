/**
 * 全局错误边界
 *
 * React 渲染期间抛出的任何未捕获异常都会在这里被接住，
 * 展示友好的错误界面而非整页白屏。
 *
 * 注：事件处理器 / 异步代码里的错误不会触发 Error Boundary，
 *    那部分错误已由各处 try/catch 处理。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    // 在控制台保留完整堆栈，方便开发排查
    console.error('[AppErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error } = this.state;
    const msg = error?.message ?? '未知错误';

    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#07080f', color: '#c8d3e8',
        fontFamily: 'system-ui, sans-serif',
        gap: 16, padding: 32, textAlign: 'center',
      }}>
        <AlertTriangle size={40} style={{ color: '#e05c5c', flexShrink: 0 }} />

        <div>
          <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#e8edf5' }}>
            页面出现了一个错误
          </p>
          <p style={{ fontSize: 13, color: '#7e90b0', margin: 0, maxWidth: 480, lineHeight: 1.6 }}>
            {msg}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 10, cursor: 'pointer',
              background: '#4d7fff', border: 'none',
              fontSize: 14, color: '#fff', fontWeight: 600,
            }}
          >
            <RefreshCw size={14} /> 重新加载
          </button>
          <button
            onClick={() => {
              // 清除本地任务数据后重载，应对存储数据损坏导致的持续白屏
              try { localStorage.removeItem('tw-tasks'); } catch { /* */ }
              window.location.reload();
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 10, cursor: 'pointer',
              background: 'transparent',
              border: '1px solid #2e3a50',
              fontSize: 14, color: '#7e90b0',
            }}
          >
            清除缓存并重载
          </button>
        </div>

        {/* 详细信息（可展开） */}
        <details style={{ maxWidth: 560, width: '100%', marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: '#4d5e75', cursor: 'pointer' }}>
            查看错误详情
          </summary>
          <pre style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 8,
            background: '#0e1018', border: '1px solid #1e2a3a',
            fontSize: 11, color: '#8fa0b8',
            textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {error?.stack ?? msg}
            {this.state.errorInfo?.componentStack}
          </pre>
        </details>
      </div>
    );
  }
}
