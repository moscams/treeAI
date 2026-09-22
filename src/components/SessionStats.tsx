import React from 'react';
import { X } from 'lucide-react';
import { Session, UsageStats } from '../types';
import { useLangStore, useT } from '../i18n';

/** token 动辄上万，加千分位好读。 */
const fmt = (n: number) => n.toLocaleString('en-US');

const Row: React.FC<{ label: string; value: React.ReactNode; title?: string }> = ({
  label,
  value,
  title,
}) => (
  <div className="flex items-center justify-between py-1" title={title}>
    <span className="text-neutral-500">{label}</span>
    <span className="font-medium text-neutral-800 tabular-nums">{value}</span>
  </div>
);

/**
 * 会话统计浮层。
 *
 * 只做「按当前 session.nodes 现场汇总」，不持久化、不改动任何数据 ——
 * 纯展示，所以每次打开重新算一遍就够了，不需要 memo。
 */
const SessionStats: React.FC<{ session: Session; onClose: () => void }> = ({ session, onClose }) => {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const nodes = session.nodes;
  const chatNodes = nodes.filter((n) => n.type === 'chat');

  const asked = chatNodes.filter((n) => n.userMessage.trim()).length;
  const answered = chatNodes.filter((n) => n.assistantMessage || n.reasoning).length;

  // 分支：同一父节点下第 2 个及以后的孩子，都是「多出来的一条分支」。
  const childCount = new Map<string, number>();
  nodes.forEach((n) => {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) || 0) + 1);
  });
  let branchPoints = 0;
  let branches = 0;
  childCount.forEach((c) => {
    if (c > 1) {
      branchPoints += 1;
      branches += c - 1;
    }
  });

  const usageNodes = chatNodes.filter((n) => n.usage);
  const sum = (pick: (u: UsageStats) => number | undefined) =>
    usageNodes.reduce((t, n) => t + (pick(n.usage!) ?? 0), 0);
  const promptTokens = sum((u) => u.promptTokens);
  const completionTokens = sum((u) => u.completionTokens);
  const reasoningTokens = sum((u) => u.reasoningTokens);
  const cacheHit = sum((u) => u.cacheHitTokens);
  const cacheMiss = sum((u) => u.cacheMissTokens);
  const cacheRate = cacheHit + cacheMiss > 0 ? Math.round((cacheHit / (cacheHit + cacheMiss)) * 100) : null;
  const answerChars = chatNodes.reduce((t, n) => t + (n.assistantMessage?.length || 0), 0);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="absolute top-14 right-4 z-20 w-64 bg-white border border-neutral-200 rounded-lg shadow-subtle p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-neutral-800">{t('会话统计')}</span>
        <button
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-neutral-700 rounded hover:bg-neutral-50 transition-colors"
          title={t('关闭')}
        >
          <X size={14} />
        </button>
      </div>

      <div className="divide-y divide-neutral-100">
        <div className="pb-1.5">
          <Row label={t('节点')} value={nodes.length} />
          <Row label={t('提问')} value={asked} />
          <Row label={t('回答')} value={answered} />
          <Row label={t('分支')} value={branches} title={t('同一父节点下第 2 个及以后的孩子')} />
          <Row label={t('分支点')} value={branchPoints} title={t('有 2 个以上孩子的节点数')} />
        </div>

        <div className="py-1.5">
          <Row label={t('↓ 输入 token')} value={fmt(promptTokens)} title={t('发给模型的 token（提示词）')} />
          <Row label={t('↑ 输出 token')} value={fmt(completionTokens)} title={t('模型生成的 token')} />
          {reasoningTokens > 0 && <Row label={t('思考 token')} value={fmt(reasoningTokens)} />}
          {cacheRate !== null && (
            <Row
              label={t('缓存命中')}
              value={`${cacheRate}%`}
              title={`${t('命中缓存 {hit} tok，未命中 {miss} tok', { hit: fmt(cacheHit), miss: fmt(cacheMiss) })}`}
            />
          )}
          {usageNodes.length > 0 && (
            <Row label={t('计费次数')} value={usageNodes.length} title={t('有 token 用量的回答数')} />
          )}
        </div>

        <div className="pt-1.5">
          <Row label={t('回答字数')} value={fmt(answerChars)} />
          <Row label={t('创建')} value={<span className="font-normal">{when(session.createdAt)}</span>} />
          <Row label={t('更新')} value={<span className="font-normal">{when(session.updatedAt)}</span>} />
        </div>
      </div>
    </div>
  );
};

export default SessionStats;
