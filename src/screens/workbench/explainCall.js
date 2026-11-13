// 「让 AI 讲透这条」的传输层（本岗只出这一份，host/token 都由调用方给，不写死）。
//
// 实测（2026-11-12，node 直连 8788）：
//   POST http://127.0.0.1:8788/api/dsh-media/explain
//   body {"text":"拖延不是懒，是怕做完之后发现自己不行","kind":"explain"}
//   → 200 / text/plain; charset=utf-8 / 5.0s / 252 字 / **一次性整段，不是流式**
//   返回形如：「1）它在说：… 2）因为… 3）比如… 4）对做内容的人意味着…」
//
// 所以 UI 侧不要假装逐字上屏：先显示「正在讲…」，整段到达后一次渲染。
// 若后端将来改成 SSE，这里换成 reader 循环即可，调用方的 onChunk 接口不用动。

export async function explainText({ baseUrl, token, text, context, signal, fetchImpl }) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('当前环境没有 fetch');
  if (!baseUrl) throw new Error('explainText 需要 baseUrl');
  if (!text || !String(text).trim()) throw new Error('没有可讲的内容');

  const res = await f(String(baseUrl).replace(/\/+$/, '') + '/api/dsh-media/explain', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(token ? { authorization: 'Bearer ' + token, cookie: 'pocket_tok=' + token } : {}),
    },
    body: JSON.stringify({ text: String(text), kind: 'explain', context: context || null }),
    signal,
  });

  const raw = await res.text();
  if (!res.ok) throw new Error('讲透失败 HTTP ' + res.status + '：' + raw.slice(0, 120));

  // 后端正常返回纯文本；万一是 JSON 里带字段，也兜住
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      if (j && j.ok === false) throw new Error(j.error || '讲透失败');
      return String(j.text || j.answer || j.content || '');
    } catch (e) {
      if (e && e.message && e.message.indexOf('讲透失败') === 0) throw e;
    }
  }
  return trimmed;
}
