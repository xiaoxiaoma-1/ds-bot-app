import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarInk, useTheme } from '../theme';
import { maskFor } from '../avatarMasks';
import CHARACTER_SHAPES from '../components/characterShapes';
import { advisors, models, writeModel } from '../api';
import { setCached, useCachedResource } from '../cache';

function displayModelName(model) {
  if (typeof model !== 'string' || !model) return '';
  // 去掉前缀
  const m = model.replace(/^(siliconflow|opendesign|deepseek-ai)\//, '');
  // 美化显示
  return m.replace(/-/g, ' ')
         .replace(/\bflash\b/i, 'Flash')
         .replace(/\bv(\d+\.\d+)/i, 'V$1')
         .trim();
}

function getModelSupplier(model) {
  if (typeof model !== 'string' || !model) return '';
  const m = model.toLowerCase();
  // I3：以前只认 siliconflow / opendesign / deepseek-ai 三种前缀，其它一律「未知」，
  // 结果满屏都是「未知」，分不清谁是谁。现在按厂商关键词认，认不出来就把模型名
  // 的第一段（/ 之前、: 之前）当供应商名显示，绝不回「未知」。
  const known = [
    ['硅基流动', ['siliconflow', 'silicon-flow']],
    ['OpenDesign', ['opendesign', 'open-design']],
    ['DeepSeek', ['deepseek']],
    ['OpenAI', ['openai', 'gpt-', '/gpt', 'o1-', 'o3-', 'o4-']],
    ['Anthropic', ['anthropic', 'claude']],
    ['Google', ['google', 'gemini', 'palm']],
    ['阿里通义', ['qwen', 'dashscope', 'tongyi', 'aliyun']],
    ['智谱', ['glm', 'zhipu', 'chatglm']],
    ['月之暗面', ['moonshot', 'kimi']],
    ['字节豆包', ['doubao', 'volcengine', 'ark-', 'bytedance']],
    ['MiniMax', ['minimax', 'abab']],
    ['百度', ['ernie', 'wenxin', 'baidu']],
    ['腾讯', ['hunyuan', 'tencent']],
    ['讯飞', ['spark', 'xfyun', 'iflytek']],
    ['Mistral', ['mistral', 'mixtral']],
    ['Meta', ['llama', 'meta-']],
    ['xAI', ['grok', 'xai']],
    ['阶跃', ['stepfun', 'step-']],
    ['零一万物', ['lingyi', 'yi-']],
  ];
  for (const [name, keys] of known) {
    if (keys.some((k) => m.includes(k))) return name;
  }
  // 认不出来：把 "vendor/model-x" 的 vendor 段提出来当名字，比「未知」有用
  const head = String(model).split('/')[0].split(':')[0].trim();
  return head && head !== model ? head : displayModelName(model) || String(model);
}

// I2：团队管理的头像要和外面列表长得一模一样（同 shape、同 tint、同眼睛），
// 以前这里是一个灰色圆角方块占位，所以「头像没显示」。
function hexToRgb(h) {
  const s = String(h || '');
  if (!/^#[0-9a-f]{6}$/i.test(s)) return null;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function mixHex(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const out = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function relLum(h) {
  const rgb = hexToRgb(h);
  if (!rgb) return 1;
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
}
const TEAM_MARK = 48;
const DEFAULT_EYES = [
  [44.5, 46, 7, 18, -8],
  [58.5, 42, 7, 18, -12],
];
function teamEyes(shape, i) {
  const list = (CHARACTER_SHAPES[shape] && CHARACTER_SHAPES[shape].eyes) || DEFAULT_EYES;
  const e = list[i];
  if (!e) return null;
  const [cx, cy, w, h, tilt] = e;
  const k = TEAM_MARK / 100;
  return {
    left: (cx - w / 2) * k,
    top: (cy - h / 2) * k,
    width: w * k,
    height: h * k,
    borderRadius: (w * k) / 2,
    tilt,
  };
}
function TeamAvatar({ avatar = {}, scheme, C }) {
  const shape = avatar.shape || 'gumdrop';
  const tint = avatar.color ? avatarInk(avatar.color, scheme) : C.ink2;
  const faceInk = relLum(tint) > 0.42 ? mixHex(tint, C.ink, 0.6) : mixHex(tint, C.onHero, 0.55);
  return (
    <View style={{ width: TEAM_MARK, height: TEAM_MARK }}>
      <Image source={{ uri: maskFor(shape) }} style={{ width: TEAM_MARK, height: TEAM_MARK, tintColor: tint }} resizeMode="contain" />
      {[0, 1].map((i) => {
        const b = teamEyes(shape, i);
        if (!b) return null;
        return (
          <View
            key={'eye' + i}
            style={{
              position: 'absolute',
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              borderRadius: b.borderRadius,
              backgroundColor: faceInk,
              transform: [{ rotate: `${b.tilt}deg` }],
            }}
          />
        );
      })}
    </View>
  );
}

export default function TeamManageScreen({ navigation }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();

  const cached = useCachedResource('dsbot:advisors', advisors);
  const [bots, setBots] = useState(() => (cached.data || []).filter(b => b.id && b.name));
  const [allModels, setAllModels] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(() => !cached.data);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [savingIds, setSavingIds] = useState([]);
  const [err, setErr] = useState(null);
  const [bulkOp, setBulkOp] = useState(null);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  // I4：页面一卸载就把 mounted 置 false，后面所有 setState / setTimeout 都先看它，
  // 避免「点返回直接闪退」（卸载后异步 setState / 定时器回来还在写状态）。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // I1：Bot 列表和模型清单分开拉、分开渲染。
  // 原来 Promise.all 等两边都回来才算加载完，models 一慢整页就是转圈一分多钟。
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const botsRes = await advisors();
      const filteredBots = (botsRes && botsRes.filter ? botsRes : []).filter((b) => b && b.id && b.name);
      if (!mounted.current) return;
      setBots(filteredBots);
      setErr(null);
      // 成功后写回缓存，下次点进来直接命中
      setCached('dsbot:advisors', filteredBots);
    } catch (e) {
      if (mounted.current) setErr((e && e.message) || '加载失败');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await models();
      if (mounted.current) setAllModels((res && Array.isArray(res)) ? res : []);
    } catch {
      // 模型清单拉不到不影响看 Bot 列表，只是「全部设为」暂时不可用
    } finally {
      if (mounted.current) setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadModels();
  }, [load, loadModels]);

  const handleExpand = useCallback((id) => {
    setExpandedId(expandedId === id ? null : id);
  }, [expandedId]);

  const getMostCommonModel = useCallback(() => {
    const modelCounts = {};
    bots.forEach(bot => {
      const model = bot.model;
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });
    
    let maxCount = 0;
    let mostCommon = '';
    Object.entries(modelCounts).forEach(([model, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = model;
      }
    });
    return mostCommon;
  }, [bots]);

  const handleSaveModel = useCallback(async (id, newModel, oldModel) => {
    try {
      setSavingIds(prev => [...prev, id]);
      setErr(null);
      await writeModel({ id, model: newModel });
      // 更新本地状态
      setBots(prev => prev.map(bot => 
        bot.id === id ? { ...bot, model: newModel } : bot
      ));
      // 收起面板
      setExpandedId(null);
    } catch (e) {
      setErr(e.message || '保存失败');
    } finally {
      setSavingIds(prev => prev.filter(sid => sid !== id));
    }
  }, []);

  // 批量设置逻辑
  const handleBulkSet = useCallback(async (model, name) => {
    // 先弹确认
    const displayName = name || displayModelName(model);
    const supplier = getModelSupplier(model);
    const targetCount = bots.filter(bot => bot.model !== model).length;
    
    // 显示确认对话框
    setBulkOp({ 
      type: 'confirm', 
      model, 
      displayName, 
      supplier, 
      targetCount 
    });
  }, [bots]);

  // 确认后执行批量设置
  const executeBulkSet = useCallback(async (model) => {
    setBulkOp({ type: 'applying', model, progress: 0 });
    const targetBots = bots.filter(bot => bot.model !== model);
    
    let success = 0;
    let fail = 0;
    
    // 并发限制
    const concurrency = 4;
    const chunks = [];
    for (let i = 0; i < targetBots.length; i += concurrency) {
      chunks.push(targetBots.slice(i, i + concurrency));
    }
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const promises = chunk.map(async (bot) => {
        try {
          const res = await writeModel({ id: bot.id, model });
          if (res.ok) {
            success++;
          } else {
            fail++;
          }
        } catch {
          fail++;
        }
      });
      
      await Promise.all(promises);
      if (!mounted.current) return;
      setBulkOp(prev => ({ ...prev, progress: success + fail }));
    }
    if (!mounted.current) return;
    
    // 更新本地状态
    setBots(prev => prev.map(bot => 
      targetBots.some(tb => tb.id === bot.id) ? { ...bot, model } : bot
    ));
    
    setBulkOp({ type: 'done', model, total: targetBots.length, success, fail });
    
    // 3秒后清空（I4：卸载后不再写状态）
    setTimeout(() => {
      if (mounted.current) setBulkOp(null);
    }, 3000);
  }, [bots]);

  const mostCommonModel = getMostCommonModel();

  if (loading && bots.length === 0 && !err) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={s.back}>返回</Text>
        </Pressable>
        <Text style={s.title}>团队管理</Text>
        <View style={s.headerRight}>
          <Text style={s.count}>{bots.length} 个</Text>
          {bots.length > 0 && allModels.length > 0 && (
            <Pressable 
              style={s.bulkBtn}
              onPress={() => setShowBulkMenu(!showBulkMenu)}
            >
              <Text style={s.bulkBtnText}>全部设为 ▾</Text>
            </Pressable>
          )}
        </View>
      </View>

      {showBulkMenu && (
        <View style={s.bulkMenu}>
          <ScrollView style={s.bulkMenuScroll}>
            {allModels.map(item => {
              const ref = item.ref;
              const display = item.name || displayModelName(ref);
              const supplier = getModelSupplier(ref);
              return (
                <Pressable
                  key={ref}
                  style={s.bulkMenuItem}
                  onPress={() => {
                    setShowBulkMenu(false);
                    handleBulkSet(ref, display);
                  }}
                >
                  <Text style={s.bulkMenuItemText}>{display}（{supplier}）</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable 
            style={s.bulkMenuCancel}
            onPress={() => setShowBulkMenu(false)}
          >
            <Text style={s.bulkMenuCancelText}>取消</Text>
          </Pressable>
        </View>
      )}

      {err && (
        <View style={s.error}>
          <Text style={s.errorText} numberOfLines={3}>{err}</Text>
          <Pressable style={[s.btn, s.btnPrimary, { alignSelf: 'flex-start', marginTop: S.x2 }]} onPress={load} accessibilityRole="button">
            <Text style={s.btnPrimaryText}>重试</Text>
          </Pressable>
        </View>
      )}

      {bulkOp && bulkOp.type === 'confirm' && (
        <View style={s.bulkConfirm}>
          <Text style={s.bulkConfirmTitle}>确认批量设置</Text>
          <Text style={s.bulkConfirmText}>
            准备将 {bulkOp.targetCount} 个 Bot 的模型设置为：
          </Text>
          <Text style={s.bulkConfirmModel}>{bulkOp.displayName}（{bulkOp.supplier}）</Text>
          <View style={s.bulkConfirmActions}>
            <Pressable 
              style={[s.btn, s.btnCancel]} 
              onPress={() => setBulkOp(null)}
            >
              <Text style={s.btnCancelText}>取消</Text>
            </Pressable>
            <Pressable 
              style={[s.btn, s.btnPrimary]} 
              onPress={() => executeBulkSet(bulkOp.model)}
            >
              <Text style={s.btnPrimaryText}>确定</Text>
            </Pressable>
          </View>
        </View>
      )}

      {bulkOp && bulkOp.type === 'applying' && (
        <View style={s.bulkProgress}>
          <Text style={s.bulkText}>正在批量设置模型… {bulkOp.progress}/{bots.length}</Text>
        </View>
      )}

      {bulkOp && bulkOp.type === 'done' && (
        <View style={s.bulkDone}>
          <Text style={s.bulkDoneText}>已更新 {bulkOp.success} 个，失败 {bulkOp.fail} 个</Text>
        </View>
      )}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {!loading && !err && bots.length === 0 ? (
          <Text style={s.emptyText}>读不到 Bot 列表，点上面重试</Text>
        ) : bots.map((bot) => {
          const isExpanded = expandedId === bot.id;
          const isSaving = savingIds.includes(bot.id);
          const isDifferent = bot.model !== mostCommonModel;
          
          return (
            <View key={bot.id} style={s.botCard}>
              <Pressable 
                style={[s.botRow, isDifferent && s.botRowBold]} 
                onPress={() => handleExpand(bot.id)}
                disabled={isSaving}
              >
                <TeamAvatar avatar={bot.avatar} scheme={scheme} C={C} />
                <View style={s.botInfo}>
                  <Text style={[s.botName, isDifferent && s.botNameBold]}>{bot.name}</Text>
                  <Text style={s.botModel} numberOfLines={1}>
                    {getModelSupplier(bot.model)} · {displayModelName(bot.model)}
                  </Text>
                </View>
                <Text style={s.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
              </Pressable>

              {isExpanded && (
                <View style={s.expandArea}>
                  <View style={s.expandContent}>
                    <View style={s.currentModel}>
                      <Text style={s.currentModelText}>当前：{getModelSupplier(bot.model)} · {displayModelName(bot.model)}</Text>
                    </View>
                    <Text style={s.chooseLabel}>改为：</Text>
                    
                    {allModels.map((item) => {
                      const ref = item.ref;
                      const displayName = item.name || displayModelName(ref);
                      const supplier = getModelSupplier(ref);
                      const isCurrent = ref === bot.model;
                      const willChangeSupplier = supplier !== getModelSupplier(bot.model);
                      
                      return (
                        <Pressable
                          key={ref}
                          style={[s.modelOption, isCurrent && s.modelOptionCurrent]}
                          onPress={() => handleSaveModel(bot.id, ref, bot.model)}
                          disabled={isSaving || isCurrent}
                        >
                          <View style={s.radio}>
                            {isCurrent ? (
                              <View style={s.radioSelected} />
                            ) : (
                              <View style={s.radioEmpty} />
                            )}
                          </View>
                          <Text style={s.modelOptionText}>
                            {displayName}（{supplier}）
                            {willChangeSupplier && (
                              <Text style={s.supplierWarning}> ⚠ 换供应商会另开新段</Text>
                            )}
                          </Text>
                        </Pressable>
                      );
                    })}

                    {isSaving && (
                      <ActivityIndicator size="small" color={C.accent} style={s.savingIndicator} />
                    )}

                    <View style={s.expandActions}>
                      <Pressable
                        style={[s.btn, s.btnCancel]}
                        onPress={() => setExpandedId(null)}
                      >
                        <Text style={s.btnCancelText}>取消</Text>
                      </Pressable>
                      <View style={s.spacer} />
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (C, T, S, R) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.x6,
    paddingVertical: S.x4,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  back: {
    color: C.accent,
    ...T.link,
  },
  title: {
    flex: 1,
    marginLeft: S.x4,
    color: C.ink,
    ...T.heading,
  },
  count: {
    color: C.placeholder,
    ...T.body,
  },
  error: {
    backgroundColor: C.card,
    marginHorizontal: S.x6,
    marginVertical: S.x3,
    padding: S.x3,
    borderRadius: R.small,
  },
  errorText: {
    color: C.bad,
    ...T.body,
  },
  bulkProgress: {
    backgroundColor: C.card,
    marginHorizontal: S.x6,
    marginVertical: S.x3,
    padding: S.x3,
    borderRadius: R.small,
    alignItems: 'center',
  },
  bulkText: {
    color: C.accent,
    ...T.body,
  },
  bulkDone: {
    backgroundColor: C.greenLight,
    marginHorizontal: S.x6,
    marginVertical: S.x3,
    padding: S.x3,
    borderRadius: R.small,
    alignItems: 'center',
  },
  bulkDoneText: {
    color: C.green,
    ...T.body,
  },
  scroll: {
    flex: 1,
  },
  botCard: {
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  botRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.x6,
    paddingVertical: S.x5,
  },
  botRowBold: {
    backgroundColor: C.card,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.line,
  },
  botInfo: {
    flex: 1,
    marginLeft: S.x4,
  },
  botName: {
    color: C.ink,
    ...T.heading,
  },
  botNameBold: {
    fontWeight: 'bold',
  },
  botModel: {
    color: C.placeholder,
    ...T.body,
    marginTop: S.x1,
  },
  expandIcon: {
    color: C.placeholder,
    fontSize: 14,
  },
  expandArea: {
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  expandContent: {
    padding: S.x6,
  },
  currentModel: {
    backgroundColor: C.bg,
    padding: S.x4,
    borderRadius: R.small,
    marginBottom: S.x4,
  },
  currentModelText: {
    color: C.ink,
    ...T.body,
  },
  chooseLabel: {
    color: C.ink,
    ...T.body,
    marginBottom: S.x3,
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.x3,
    paddingHorizontal: S.x4,
    borderRadius: R.small,
    marginBottom: S.x2,
    backgroundColor: C.bg,
  },
  modelOptionCurrent: {
    backgroundColor: C.accentLight,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: S.x3,
  },
  radioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.accent,
  },
  radioEmpty: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modelOptionText: {
    color: C.ink,
    ...T.body,
    flex: 1,
  },
  supplierWarning: {
    color: C.bad,
    fontSize: 12,
  },
  savingIndicator: {
    marginTop: S.x3,
  },
  expandActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: S.x6,
  },
  btn: {
    paddingHorizontal: S.x6,
    paddingVertical: S.x3,
    borderRadius: R.capsule,
    minWidth: 80,
    alignItems: 'center',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.line,
  },
  btnCancelText: {
    color: C.placeholder,
    ...T.body,
  },
  spacer: {
    width: S.x3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.x3,
  },
  bulkBtn: {
    paddingHorizontal: S.x4,
    paddingVertical: S.x2,
    borderRadius: R.small,
    backgroundColor: C.card,
  },
  bulkBtnText: {
    color: C.ink,
    ...T.body,
  },
  bulkMenu: {
    position: 'absolute',
    top: 60,
    right: S.x6,
    backgroundColor: C.card,
    borderRadius: R.small,
    borderWidth: 1,
    borderColor: C.line,
    zIndex: 100,
    minWidth: 200,
    maxHeight: 300,
  },
  bulkMenuScroll: {
    maxHeight: 250,
  },
  bulkMenuItem: {
    paddingHorizontal: S.x6,
    paddingVertical: S.x4,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  bulkMenuItemText: {
    color: C.ink,
    ...T.body,
  },
  bulkMenuCancel: {
    paddingHorizontal: S.x6,
    paddingVertical: S.x4,
    borderTopWidth: 1,
    borderTopColor: C.line,
    alignItems: 'center',
  },
  bulkMenuCancelText: {
    color: C.placeholder,
    ...T.body,
  },
  bulkConfirm: {
    position: 'absolute',
    top: 100,
    left: S.x6,
    right: S.x6,
    backgroundColor: C.card,
    borderRadius: R.big,
    padding: S.x6,
    zIndex: 100,
    borderWidth: 1,
    borderColor: C.line,
  },
  bulkConfirmTitle: {
    color: C.ink,
    ...T.heading,
    marginBottom: S.x4,
  },
  bulkConfirmText: {
    color: C.ink2,
    ...T.body,
    marginBottom: S.x3,
  },
  bulkConfirmModel: {
    color: C.accent,
    ...T.title,
    marginBottom: S.x6,
  },
  bulkConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: S.x3,
  },
  btnPrimary: {
    backgroundColor: C.accent,
  },
  btnPrimaryText: {
    color: C.onAccent,
    ...T.body,
  },
  emptyText: { color: C.ink3, textAlign: 'center', marginTop: S.x8 },
});