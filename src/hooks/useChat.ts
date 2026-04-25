import { useState, useCallback } from 'react';
import type { ChatMessage, Settings } from '../types';
import { resolveApiBase } from '../config/urls';

function generateId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function callOpenAI(
  messages: { role: string; content: string }[],
  settings: Settings,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
) {
  const baseUrl = resolveApiBase(settings.apiBaseUrl);
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API 错误 ${resp.status}: ${err}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch { /* skip */ }
    }
  }
}

export function useChat(settings: Settings) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = { current: null as AbortController | null };

  const send = useCallback(async (userText: string, transcript?: string) => {
    if (!userText.trim() || isLoading) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: userText.trim(),
      timestamp: Date.now(),
    };

    const assistantId = generateId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    if (!settings.apiKey) {
      // Demo mode
      await new Promise(r => setTimeout(r, 800));
      const demo = `（演示模式）您提问了：「${userText}」\n\n请在右上角设置中填写 API Key 以启用真实 AI 回答。`;
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: demo } : m)
      );
      setIsLoading(false);
      return;
    }

    const systemPrompt = transcript
      ? `你是一位专业的教学助手。以下是课堂录音转写内容，请基于这些内容回答学生的问题：\n\n${transcript}`
      : '你是一位专业的教学助手，帮助教师和学生解答问题、整理知识点、生成教学内容。';

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText.trim() },
    ];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await callOpenAI(apiMessages, settings, controller.signal, (chunk) => {
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
        );
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : '请求失败';
      setError(msg);
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: `❌ ${msg}` } : m)
      );
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [isLoading, messages, settings]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, send, cancel, clearMessages };
}
