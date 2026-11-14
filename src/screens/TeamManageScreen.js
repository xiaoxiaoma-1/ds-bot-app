import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
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
  if (model.includes('siliconflow')) return '硅基';
  if (model.includes('opendesign')) return 'OpenDesign';
  if (model.includes('deepseek-ai')) return 'DeepSeek';
  return '未知';
}

export default function TeamManageScreen({ navigation }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();

  const cached = useCachedResource('dsbot:advisors', advisors);
  const [bots, setBots] = useState(() => (cached.data || []).filter(b => b.id && b.name));
  const [allModels, setAllModels] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(() => !cached.data);
  const [savingIds, setSavingIds] = useState([]);
  const [err, setErr] = useState(null);
  const [bulkOp, setBulkOp] = useState(null);
  const [showBulkMenu, setShowBulkMenu] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [botsRes, modelsRes] = await Promise.all([
        advisors(),
        models(),
      ]);
      const filteredBots = botsRes?.filter(b => b.id && b.name) || [];
      setBots(filteredBots);
      setAllModels(modelsRes || []);
      setErr(null);
      // 成功后写回缓存，下次点进来直接命中
      setCached('dsbot:advisors', filteredBots);
    } catch (e) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      setBulkOp(prev => ({ ...prev, progress: success + fail }));
    }
    
    // 更新本地状态
    setBots(prev => prev.map(bot => 
      targetBots.some(tb => tb.id === bot.id) ? { ...bot, model } : bot
    ));
    
    setBulkOp({ type: 'done', model, total: targetBots.length, success, fail });
    
    // 3秒后清空
    setTimeout(() => setBulkOp(null), 3000);
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
                <View style={s.avatarPlaceholder} />
                <View style={s.botInfo}>
                  <Text style={[s.botName, isDifferent && s.botNameBold]}>{bot.name}</Text>
                  <Text style={s.botModel}>{displayModelName(bot.model)}</Text>
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