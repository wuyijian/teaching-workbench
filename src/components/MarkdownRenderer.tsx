import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
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

export function MarkdownRenderer({ content }: Props) {
  return (
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
        // Inline code
        code: ({ inline, className: cls, children, ...rest }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
          const match = /language-(\w+)/.exec(cls ?? '');
          const codeText = String(children).replace(/\n$/, '');
          if (!inline && (match || codeText.includes('\n'))) {
            return <CodeBlock language={match?.[1] ?? ''} code={codeText} />;
          }
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
      {content}
    </ReactMarkdown>
  );
}
