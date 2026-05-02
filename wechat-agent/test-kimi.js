#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

const LLM_API_KEY  = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1';
const LLM_MODEL    = process.env.LLM_MODEL    || 'kimi-k2.5';

console.log('API Key:', LLM_API_KEY?.slice(0, 8) + '...');
console.log('Model:  ', LLM_MODEL);
console.log('Base:   ', LLM_BASE_URL);

(async () => {
  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: '你好，请回复"测试成功"' }],
      max_tokens: 50,
    }),
  });
  const text = await resp.text();
  console.log('\nHTTP Status:', resp.status);
  console.log('Response:', text.slice(0, 500));
})();
