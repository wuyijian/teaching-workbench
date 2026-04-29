import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  content: string;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700">
        <span className="text-xs text-slate-400 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-xs font-mono text-slate-200 leading-relaxed scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── 局部 Error Boundary，防止流式输出中间态 markdown 崩溃 ─────────────────

class MarkdownErrorBoundary extends Component<
  { children: ReactNode; fallback: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.warn('[MarkdownRenderer] render error, falling back to plain text', err, info);
  }
  componentDidUpdate(prev: { fallback: string }) {
    // 内容更新时重置错误，让新内容继续尝试渲染
    if (prev.fallback !== this.props.fallback && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      // 降级：纯文本展示，不会再崩
      return (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
          {this.props.fallback}
        </pre>
      );
    }
    return this.props.children;
  }
}

// ─── 流式 markdown 安全处理 ───────────────────────────────────────────────────
// AI 流式输出时 markdown 处于中间态（未闭合表格行、代码块等），
// remark-gfm 偶尔会在这些边界情况抛异常。
// 这里做保守处理：去掉末尾可能不完整的表格行（| 开头但没有结束 |）。
function sanitizeStreamingMarkdown(raw: string): string {
  const lines = raw.split('\n');
  // 如果最后一行是未闭合的表格行（以 | 开头但不以 | 结尾），截掉
  const last = lines[lines.length - 1];
  if (last && last.trimStart().startsWith('|') && !last.trimEnd().endsWith('|')) {
    return lines.slice(0, -1).join('\n');
  }
  return raw;
}

// ─── MarkdownRenderer ─────────────────────────────────────────────────────────

export function MarkdownRenderer({ content }: Props) {
  const safeContent = sanitizeStreamingMarkdown(content);
  return (
    <MarkdownErrorBoundary fallback={content}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ children }) => <h1 className="text-base font-bold text-slate-100 mt-4 mb-2 pb-1 border-b border-slate-700">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-slate-100 mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-200 mt-2 mb-1">{children}</h3>,
          // Paragraphs
          p: ({ children }) => <p className="text-sm text-slate-200 leading-relaxed mb-2 last:mb-0">{children}</p>,
          // Lists
          ul: ({ children }) => <ul className="my-1.5 space-y-0.5 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 space-y-0.5 pl-1 list-none counter-reset-item">{children}</ol>,
          li: ({ children, ...props }) => {
            const ordered = (props as { ordered?: boolean }).ordered;
            return (
              <li className="flex gap-2 text-sm text-slate-200 leading-relaxed">
                <span className="text-slate-500 shrink-0 mt-0.5 select-none">
                  {ordered ? '·' : '•'}
                </span>
                <span>{children}</span>
              </li>
            );
          },
          // Code — react-markdown v10 移除了 inline prop，改为通过 className 判断
          // 有 language-xxx className → 围栏代码块（block）
          // 无 className → 行内代码（inline）
          code: ({ className: cls, children, ...rest }) => {
            const match = /language-(\w+)/.exec(cls ?? '');
            const codeText = String(children).replace(/\n$/, '');
            // 是块级代码（有语言标注，或内容多行）
            if (match || codeText.includes('\n')) {
              return <CodeBlock language={match?.[1] ?? ''} code={codeText} />;
            }
            // 行内代码
            return (
              <code
                className="bg-slate-700/70 text-indigo-300 text-xs px-1.5 py-0.5 rounded font-mono"
                {...rest}
              >
                {children}
              </code>
            );
          },
          // Pre (wrap handled by code above)
          pre: ({ children }) => <>{children}</>,
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 my-2 text-slate-400 italic">
              {children}
            </blockquote>
          ),
          // Strong / Em
          strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
          em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
          // Horizontal rule
          hr: () => <hr className="my-3 border-slate-700" />,
          // Table
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-800">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-slate-700">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-1.5 text-left text-slate-300 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5 text-slate-300">{children}</td>,
          // Link
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
              {children}
            </a>
          ),
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}
