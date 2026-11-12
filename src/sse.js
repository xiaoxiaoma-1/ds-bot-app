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
