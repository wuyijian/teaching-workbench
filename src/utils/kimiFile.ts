/**
 * Kimi 文件上传 / 删除工具
 * 用于试卷分析功能：将 PDF / 图片上传到 Kimi，在 AI 对话中以 file_id 引用
 */

/**
 * 上传文件到 Kimi，返回 file_id
 * POST {baseUrl}/files  Content-Type: multipart/form-data
 * purpose="file-extract" 让 Kimi 解析文件内容（支持 PDF / 图片）
 */
export async function uploadFileToKimi(
  file: File,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('purpose', 'file-extract');

  const resp = await fetch(`${normalizedBase}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kimi 文件上传失败（HTTP ${resp.status}）: ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as { id?: string };
  if (!data.id) throw new Error('Kimi 文件上传响应缺少 id 字段');
  return data.id;
}

/**
 * 获取 Kimi 已上传文件的提取文本内容
 * GET {baseUrl}/files/{file_id}/content
 * purpose=file-extract 时 Kimi 会返回解析出的纯文本
 */
export async function getKimiFileContent(
  fileId: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const resp = await fetch(`${normalizedBase}/files/${fileId}/content`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kimi 文件内容获取失败（HTTP ${resp.status}）: ${text.slice(0, 200)}`);
  }

  return resp.text();
}

/**
 * 删除 Kimi 上的文件（任务删除时清理，失败静默忽略）
 */
export async function deleteKimiFile(
  fileId: string,
  apiKey: string,
  baseUrl: string,
): Promise<void> {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  await fetch(`${normalizedBase}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
