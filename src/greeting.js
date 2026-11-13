// 问候语与日期：首页和工作台共用一份，别两边各写一套。
// 不许写死「11月12日」——老板每天都会看见它。
export function buildGreetingAndDate(now) {
  const d = now instanceof Date ? now : new Date();
  const h = d.getHours();
  const greeting = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return { greeting, dateText: `${d.getMonth() + 1}月${d.getDate()}日 周${week}` };
}
