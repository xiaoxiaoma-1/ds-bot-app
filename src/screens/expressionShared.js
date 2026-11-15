import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// 表达训练 · 两个栈层共用的一点点「文稿渲染」。
// 拆出本文件的原因：训练页（输入）和点评表（结果）现在是两个栈层，
// 词级标注 / 点评 Markdown 的解析与渲染两边都要用，不许各写一份 —— 两份就会慢慢长得不一样。

// 词级三段颜色是老板给的原值；下划线形态受 RN 的 Text 限制（见交付说明）
export const SPAN = {
  filler: { color: '#ff6b6b', textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: '#ff6b6b' },
  hedge: { color: '#ffa94d' },
  vague: { color: '#ffd43b', textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: '#ffd43b' },
};

// 四个数字的颜色按老板给的顺序：笼统 / 填充 / 犹豫 / 密度
export const STATS = [
  { k: 'vague', label: '笼统', color: '#ff6b6b' },
  { k: 'fillers', label: '填充', color: '#ffa94d' },
  { k: 'hedges', label: '犹豫', color: '#ffd43b' },
  { k: 'density', label: '密度', color: '#69db7c' },
];

const SPAN_RE = /<span class="(vague|filler|hedge)">([\s\S]*?)<\/span>/g;
export const MARK_CAP = 2000; // 标色最多吃这么多字，其余按纯文本跟在后面

// 后端给的是已经拼好 span 的 HTML（不转义、不按分词），这儿只做「切成片段」，
// 不在前端重写标色规则。切不出片段就整段当纯文本，不报错。
export function parseHighlight(html) {
  const segs = [];
  let last = 0;
  let m;
  SPAN_RE.lastIndex = 0;
  const src = String(html || '');
  while ((m = SPAN_RE.exec(src))) {
    if (m.index > last) segs.push({ text: src.slice(last, m.index), cls: null });
    segs.push({ text: m[2], cls: m[1] });
    last = m.index + m[0].length;
  }
  if (last < src.length) segs.push({ text: src.slice(last), cls: null });
  return segs;
}

// 超 2000 字：只给前 2000 字上色，其余纯文本跟后面
export function capSegs(segs) {
  const out = [];
  let used = 0;
  let cut = false;
  for (const g of segs) {
    if (used >= MARK_CAP) {
      cut = true;
      out.push({ text: g.text, cls: null });
      continue;
    }
    const room = MARK_CAP - used;
    if (g.text.length <= room) {
      out.push(g);
      used += g.text.length;
    } else {
      out.push({ text: g.text.slice(0, room), cls: g.cls });
      out.push({ text: g.text.slice(room), cls: null });
      used = MARK_CAP;
      cut = true;
    }
  }
  return { segs: out, cut };
}

// 标注版整段：segs 不变就不重渲染。父组件每次流式 flush 都会重渲染，
// 这一层 memo 挡住的正是「约 2000 个 span 子节点被反复走一遍」——那才是 1600 个 delta 卡死的来源。
export const DocText = memo(function DocText({ segs, style }) {
  return (
    <Text style={style} allowFontScaling={false}>
      {segs.map((g, i) =>
        g.cls ? (
          <Text key={i} style={SPAN[g.cls]}>
            {g.text}
          </Text>
        ) : (
          g.text
        ),
      )}
    </Text>
  );
});

// 点评 Markdown：只认四种语法——「## 」标题、**加粗**、行首「- 」列表项、\n 换行。
// 不引第三方库，自己解析。必须按整篇解析：chunks 是按 200 字硬切的，
// 分块渲染会把 ** 和行首「- 」切在两个块里，标记就渲染不出来。
const MD_HEAD = /^ {0,3}##[ \t]+(.+)$/;
const MD_ITEM = /^ {0,3}-[ \t]+(.+)$/;
const MD_BOLD = /\*\*([^*]+)\*\*/g;

// 行内加粗：返回「纯字符串 / 加粗 Text」混合数组送给外层 Text
function mdInline(text, style, key) {
  const out = [];
  let last = 0;
  let m;
  MD_BOLD.lastIndex = 0;
  while ((m = MD_BOLD.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Text key={`${key}-${m.index}`} style={[style, { fontWeight: '600' }]} allowFontScaling={false}>
        {m[1]}
      </Text>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 逐行定块：h 标题 / li 列表 / p 段落 / sp 空行
function mdBlocks(text) {
  return String(text || '')
    .split('\n')
    .map((line, i) => {
      const head = line.match(MD_HEAD);
      if (head) return { t: 'h', k: i, text: head[1] };
      const item = line.match(MD_ITEM);
      if (item) return { t: 'li', k: i, text: item[1] };
      return line.trim() ? { t: 'p', k: i, text: line.trim() } : { t: 'sp', k: i };
    });
}

// 点评渲染：整篇文本变了才重解析（useMemo + memo 双层，流式 flush 不会重复解析同一份文本）
export const MdText = memo(function MdText({ text, style }) {
  const base = StyleSheet.flatten(style) || {};
  const blocks = useMemo(() => mdBlocks(text), [text]);
  const size = base.fontSize || 15;
  const lh = base.lineHeight || 21;
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, idx) => {
        if (b.t === 'sp') {
          return idx === blocks.length - 1 ? null : <View key={b.k} style={{ height: 4 }} />;
        }
        if (b.t === 'h') {
          return (
            <Text
              key={b.k}
              style={[style, { fontWeight: '600', fontSize: size * 1.22, lineHeight: lh * 1.35, marginTop: idx > 0 ? 6 : 0 }]}
              allowFontScaling={false}
            >
              {mdInline(b.text, style, b.k)}
            </Text>
          );
        }
        if (b.t === 'li') {
          return (
            <View key={b.k} style={{ flexDirection: 'row', paddingLeft: 2 }}>
              <Text style={style} allowFontScaling={false}>
                •{' '}
              </Text>
              <Text style={[style, { flex: 1 }]} allowFontScaling={false}>
                {mdInline(b.text, style, b.k)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={b.k} style={style} allowFontScaling={false}>
            {mdInline(b.text, style, b.k)}
          </Text>
        );
      })}
    </View>
  );
});
