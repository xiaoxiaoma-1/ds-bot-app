// SSE 长连接（纯 JS，不依赖任何原生模块，也不 import RN）——
// 这样同一份解析/重连逻辑能在 Node 里被同一个自测脚本直接加载验证。
//
// 协议（后端 2026-11-12 实测）：
//   GET /api/dsbot/feed   Authorization: Bearer <session>   Accept: text/event-stream
//   event: hello    data: {"revision":5414}
//   event: message  data: {botId, sessionId, item:{kind,text,time,seq}}
//   event: stream   data: {botId, sessionId, attemptId, phase:"start"|"end"} 或 {…, text:"增量"}
//   以 ":" 开头的行是心跳注释，忽略。
//
// 重连：断线后 2 秒退避重连，连续失败时翻倍到最多 10 秒；收到 hello 就把退避重置。
// 401：不重连，直接回调 onAuthFail —— 会话过期要人去重新登录，重连只会无限打空转。

export function splitFrames(buffer) {
  // SSE 帧以空行分隔；返回 [完整帧数组, 剩余不完整部分]
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return [parts, rest];
}

export function parseFrame(frame) {
  const lines = frame.split('\n');
  let event = '';
  const dataLines = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '' || line.startsWith(':')) continue; // 心跳/注释
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!event && dataLines.length === 0) return null;
  let data = null;
  if (dataLines.length) {
    const joined = dataLines.join('\n');
    try {
      data = JSON.parse(joined);
    } catch {
      data = joined;
    }
  }
  return { event, data };
}

export function createFeed(options) {
  const {
    url,
    token,
    xhrFactory,
    onEvent,
    onError,
    onAuthFail,
    reconnect = true,
    reconnectDelay = 2000,
    maxDelay = 10000,
  } = options;

  let xhr = null;
  let closed = false;
  let buffer = '';
  let delay = reconnectDelay;
  let timer = null;
  let attempt = 0;

  function scheduleReconnect() {
    if (closed || !reconnect) return;
    const wait = delay;
    delay = Math.min(delay * 2, maxDelay);
    timer = setTimeout(() => {
      timer = null;
      open();
    }, wait);
  }

  function handleChunk(text) {
    buffer += text;
    const [frames, rest] = splitFrames(buffer);
    buffer = rest;
    for (const f of frames) {
      const parsed = parseFrame(f);
      if (!parsed) continue;
      if (parsed.event === 'hello') {
        delay = reconnectDelay; // 连上了，退避归位
        attempt = 0;
      }
      try {
        onEvent && onEvent(parsed.event, parsed.data);
      } catch (e) {
        // 消费方抛错不能弄死连接
        onError && onError(e);
      }
    }
  }

  function open() {
    if (closed) return;
    attempt += 1;
    buffer = '';
    const x = xhrFactory();
    xhr = x;
    let aborted = false;
    x.open('GET', url, true);
    x.setRequestHeader('authorization', 'Bearer ' + token);
    x.setRequestHeader('accept', 'text/event-stream');
    x.setRequestHeader('cache-control', 'no-cache');

    let seen = 0;
    x.onprogress = () => {
      if (aborted || closed) return;
      const all = x.responseText || '';
      if (all.length <= seen) return;
      handleChunk(all.slice(seen));
      seen = all.length;
    };

    x.onloadend = () => {
      if (aborted || closed) return;
      const status = Number(x.status) || 0;
      if (status === 401 || status === 403) {
        onAuthFail && onAuthFail(status);
        return; // 不重连
      }
      if (attempt === 1) onError && onError(Object.assign(new Error('流断了'), { code: 'CLOSED' }));
      scheduleReconnect();
    };

    x.onerror = () => {
      if (aborted || closed) return;
      onError && onError(Object.assign(new Error('网络错误'), { code: 'NETWORK' }));
      // onloadend 通常也会来，但某些平台只给 onerror，这里兜一次
      scheduleReconnect();
    };

    x.send();
  }

  open();

  return {
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        xhr && xhr.abort();
      } catch {}
      xhr = null;
    },
    // 自测用：暴露内部状态
    _state() {
      return { closed, delay, attempt, hasTimer: Boolean(timer), bufferLen: buffer.length };
    },
  };
}

// ── 一次性 POST 流（表达训练「点评」边生成边显示，2026-11-13）────────────────
// 与 createFeed 的差别：POST + JSON body + 不重连 + 不依赖 XHR（fetch + body.getReader）。
// 复用上面的 splitFrames / parseFrame，解析逻辑只有这一份。
// 事件：start {ok} / delta {t} / done {ok,chars,ms} / error {ok:false,error}
// 没收到 done 就结束 → 按中断处理（已收到的内容由调用方保留）。
export async function readEventStream({
  url,
  token,
  body,
  signal,
  onStart,
  onDelta,
  onDone,
  onError,
}) {
  let finished = false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: token ? 'Bearer ' + token : undefined,
      },
      body: JSON.stringify(body || {}),
      credentials: 'include',
      signal,
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch {}
      if (onError) onError(msg);
      return { ok: false, error: msg };
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      if (onError) onError('这个运行环境不支持流式读取');
      return { ok: false, error: 'no-stream' };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const [frames, rest] = splitFrames(buf);
      buf = rest;
      for (const f of frames) {
        const ev = parseFrame(f);
        if (!ev) continue;
        const d = ev.data;
        if (ev.event === 'start') {
          if (onStart) onStart(d);
        } else if (ev.event === 'delta') {
          if (onDelta && d && typeof d.t === 'string') onDelta(d.t);
        } else if (ev.event === 'done') {
          finished = true;
          if (onDone) onDone(d);
        } else if (ev.event === 'error') {
          finished = true;
          if (onError) onError((d && d.error) || '生成失败');
        }
      }
      if (finished) break;
    }
    if (!finished) {
      if (onError) onError('生成中断');
      return { ok: false, error: '中断' };
    }
    return { ok: true };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, aborted: true };
    const msg = e && e.message ? e.message : '网络不通';
    if (onError) onError(msg);
    return { ok: false, error: msg };
  }
}
