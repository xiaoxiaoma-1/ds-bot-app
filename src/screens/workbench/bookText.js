// 书库正文的文本处理（2026-11-14）
//
// 三件事，全部是纯函数，不碰 RN、不碰网络：
//   reflow(text)        中文重排：干掉 OCR 的硬换行，只留段落分隔
//   toSimplified(text)  繁体 → 简体（字级映射，不用第三方依赖）
//   cleanTitle(title)   书名去掉「004(数学名著译丛) 」这类丛书编号前缀
//   paginate(lines, …)  按实测行高切页（E4 的分页算法）
//
// 为什么要 reflow：后端正文是从原书 OCR 出来的，每行约 26 个字就有一个硬 \n（原书版心宽度）。
// 手机一行只放得下 13 个字，于是每个硬换行都在半行处硬断，段落末尾只剩两三个孤字
// ——「根据这两个字明明是连在一起的，但是它会跟回车句子在下面」就是它。

// 单行结尾/开头是拉丁字母或数字时，拼接要补一个空格，否则英文单词会粘连。
function needsSpace(left, right) {
  return /[A-Za-z0-9,.;:!?]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

/**
 * 中文重排。
 *   · \r\n / \r 先统一成 \n
 *   · 单个 \n = OCR 的换行 → 直接拼掉（中文不需要空格）
 *   · 连续 ≥2 个 \n = 真正的段落分隔 → 收拢成 \n\n
 * @param {string} text
 * @returns {string}
 */
export function reflow(text) {
  if (typeof text !== 'string' || !text) return '';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let sawBlank = false;
  for (const raw of lines) {
    const line = raw.replace(/^[\s\u00a0\u3000]+/, '').replace(/[\s\u00a0\u3000]+$/, '');
    if (line === '') {
      sawBlank = true;
      continue;
    }
    if (out.length === 0) {
      out.push(line);
    } else if (sawBlank) {
      out.push('\n\n');
      out.push(line);
    } else {
      const prev = out[out.length - 1];
      out[out.length - 1] = prev + (needsSpace(prev, line) ? ' ' : '') + line;
    }
    sawBlank = false;
  }
  // 兜底：合并出来的 \n\n 再收一遍（≥3 个空行只留一个段落间隔）
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

// 繁体 → 简体：常见字的字级映射，严格「两字一组」（繁体在前、简体在后）。
// 说明：覆盖书库现有那批书（理论 / 统计 / 通讯 / 机器 这类）的常用字，
// 不做词组级、不做异体字考订；表里没有的字原样保留（宁可留繁体，也不能改错字）。
const TRAD_PAIRS =
  '與与這这為为個个們们時时說说會会來来對对過过還还點点國国學学發发現现' +
  '開开關关進进動动長长問问間间樣样麼么實实應应當当經经種种後后從从識识' +
  '覺觉語语讀读寫写書书紙纸筆笔記记憶忆講讲話话數数變变聲声氣气電电體体' +
  '腦脑網网絡络軟软處处場场報报壓压響响準准係系據据權权錢钱買买賣卖貨货' +
  '價价貴贵輕轻運运输输轉转達达週周邊边遠远適适選选確确認认釋释鐘钟鐵铁' +
  '銀银銅铜陽阳陰阴繼继續续斷断緣缘線线練练織织總总聯联職职聽听腳脚臉脸' +
  '臨临興兴舉举舊旧蓋盖藝艺號号蟲虫術术衛卫裝装製制複复見见規规視视親亲' +
  '觀观訂订訓训託托設设許许訴诉診诊評评詞词試试詩诗該该詳详誰谁課课調调' +
  '談谈請请論论諸诸謀谋謝谢證证譯译議议護护讓让讚赞豐丰豬猪貝贝負负財财' +
  '貢贡貧贫責责敗败帳账資资賓宾賜赐賞赏賢贤質质購购賽赛贈赠贊赞贏赢趨趋' +
  '車车軌轨軍军載载較较輔辅輛辆輝辉輩辈辦办農农郵邮鄉乡醫医針针鈔钞錯错' +
  '鍵键鏡镜門门閉闭闖闯閒闲閱阅陸陆隨随險险隱隐雙双難难雲云雷雷靈灵靜静' +
  '頁页頂顶項项順顺須须測测頭头頓顿頻频題题額额風风飛飞飯饭飲饮養养餓饿' +
  '餘余館馆馬马駐驻驗验鬥斗魚鱼鳥鸟麗丽黨党齊齐齒齿龍龙龜龟齡龄髮发';

const TRAD_TO_SIMP = (() => {
  const m = Object.create(null);
  const compact = TRAD_PAIRS.replace(/\s+/g, '');
  for (let i = 0; i + 1 < compact.length; i += 2) {
    const t = compact[i];
    const s = compact[i + 1];
    if (t && s && t !== s) m[t] = s;
  }
  return m;
})();

/**
 * 繁体转简体（字级）。表里没有的字原样保留。
 * @param {string} text
 * @returns {string}
 */
export function toSimplified(text) {
  if (typeof text !== 'string' || !text) return text || '';
  let out = '';
  for (const ch of text) out += TRAD_TO_SIMP[ch] || ch;
  return out;
}

// 书名前缀：`004(数学名著译丛) `、`012（汉译世界学术名著丛书）` 这类编号 + 丛书名
const TITLE_PREFIX = /^\d+\s*[（(][^）)]*[）)]\s*/;

/**
 * 显示用书名：剥掉丛书编号前缀。原文（含前缀）留在列表详情的 book.title 里，可查。
 * 纯英文书名那批不在这一版处理范围。
 * @param {string} title
 * @returns {string}
 */
export function cleanTitle(title) {
  const t = typeof title === 'string' ? title : '';
  const stripped = t.replace(TITLE_PREFIX, '').trim();
  return stripped || t;
}

/**
 * 按实测行高切页。
 * @param {Array<{text:string, height:number, start:number, end:number}>} lines onTextLayout 量出来的行
 * @param {number} pageHeight 一页正文可用的高度
 * @returns {Array<{start:number, end:number}>} 每页在正文里的字符区间
 */
export function paginate(lines, pageHeight) {
  if (!Array.isArray(lines) || lines.length === 0 || !(pageHeight > 0)) return [];
  const pages = [];
  let cursor = 0;
  let used = 0;
  for (const line of lines) {
    const h = Number(line && line.height) || 0;
    if (used > 0 && used + h > pageHeight) {
      pages.push({ start: cursor, end: Number(line.start) || 0 });
      cursor = Number(line.start) || 0;
      used = 0;
    }
    used += h;
  }
  const last = lines[lines.length - 1];
  pages.push({ start: cursor, end: Number(last.end) || 0 });
  return pages;
}
