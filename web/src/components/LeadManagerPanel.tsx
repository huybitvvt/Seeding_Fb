'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { Lead } from '@/lib/types';
import { LeadHunterSettingsModal } from '@/components/LeadHunterSettingsModal';
import type { LeadHunterConfig } from '@/lib/lead-hunter-config';
import { loadLeadHunterConfig, SCORE_RULE_LABELS } from '@/lib/lead-hunter-config';
import {
  enrichLead,
  formatLeadDateTime,
  isProcessedLead,
  leadLevelFromScore,
  type LeadLevelId,
} from '@/lib/lead-hunter';

type LeadRow = Lead & { post_id?: string };
type LeadSelection = { postId: string; leadKey: string };

function selectionKey(postId: string, leadKey: string) {
  return `${postId}|${leadKey}`;
}

function LeadLevelBadge({
  score,
  label,
  config,
  showScore = false,
}: {
  score: number;
  label: string;
  config: LeadHunterConfig;
  showScore?: boolean;
}) {
  const level = leadLevelFromScore(score, config);
  const text = showScore ? `${score} · ${level.label}` : (label || level.label);
  return (
    <span
      className="lead-level-badge"
      style={{ color: level.color, background: level.bg }}
      title={label || level.label}
    >
      {text}
    </span>
  );
}

export function LeadManagerPanel({
  leads,
  groupNames = {},
  busy,
  onDelete,
  onDeleteMany,
}: {
  leads: Record<string, Lead[]>;
  groupNames?: Record<string, string>;
  busy?: boolean;
  onDelete: (postId: string, leadKey: string, name?: string) => Promise<void>;
  onDeleteMany: (items: LeadSelection[]) => Promise<void>;
}) {
  const [config, setConfig] = useState<LeadHunterConfig>(() => loadLeadHunterConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LeadLevelId | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [minScore, setMinScore] = useState('');
  const [showScoreTable, setShowScoreTable] = useState(false);

  const rows = useMemo<LeadRow[]>(
    () =>
      Object.entries(leads)
        .flatMap(([postId, items]) => (items || []).map((item) => enrichLead({ ...item, post_id: postId }, config)))
        .filter((item) => isProcessedLead(item))
        .sort((a, b) => {
          const at = new Date(a.processed_at || 0).getTime();
          const bt = new Date(b.processed_at || 0).getTime();
          if (bt !== at) return bt - at;
          return (b.score || 0) - (a.score || 0);
        }),
    [leads, config],
  );

  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      const levelId = row.lead_level || leadLevelFromScore(row.score || 0, config).id;
      if (levelFilter && levelId !== levelFilter) return false;
      if (statusFilter && (row.crm_status || '') !== statusFilter) return false;
      const min = Number(minScore);
      if (minScore.trim() && Number.isFinite(min) && (row.score || 0) < min) return false;
      if (!q) return true;
      const hay = [
        row.name,
        row.need,
        row.phone,
        row.processed_by,
        row.group_id && groupNames[row.group_id],
        row.crm_status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, levelFilter, statusFilter, searchText, minScore, config, groupNames]);

  const levelStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const level of config.levels) counts[level.id] = 0;
    for (const row of rows) {
      const id = row.lead_level || leadLevelFromScore(row.score || 0, config).id;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [rows, config]);

  const selectableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of filteredRows) {
      if (item.lead_key && item.post_id) {
        keys.add(selectionKey(item.post_id, item.lead_key));
      }
    }
    return keys;
  }, [filteredRows]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedItems = useMemo(() => {
    const items: LeadSelection[] = [];
    for (const item of filteredRows) {
      if (!item.lead_key || !item.post_id) continue;
      const key = selectionKey(item.post_id, item.lead_key);
      if (!selectableKeys.has(key) || !selected[key]) continue;
      items.push({ postId: item.post_id, leadKey: item.lead_key });
    }
    return items;
  }, [filteredRows, selectableKeys, selected]);
  const allSelected = selectableKeys.size > 0 && selectedItems.length === selectableKeys.size;
  const hasSelectableRows = selectableKeys.size > 0;
  const hasActiveFilter = Boolean(levelFilter || statusFilter || searchText.trim() || minScore.trim());

  function toggleRow(postId: string, leadKey: string, checked: boolean) {
    const key = selectionKey(postId, leadKey);
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[key] = true;
      else delete next[key];
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of filteredRows) {
      if (!item.lead_key || !item.post_id) continue;
      next[selectionKey(item.post_id, item.lead_key)] = true;
    }
    setSelected(next);
  }

  function toggleLevelFilter(levelId: LeadLevelId) {
    setLevelFilter((prev) => (prev === levelId ? '' : levelId));
    setSelected({});
  }

  function clearFilters() {
    setLevelFilter('');
    setStatusFilter('');
    setSearchText('');
    setMinScore('');
    setSelected({});
  }

  return (
    <section className="module-panel">
      <div className="module-head">
        <div>
          <div className="module-kicker">Lead Hunter · F-Solution</div>
          <h2>Bể Lead CRM</h2>
          <p className="module-sub">
            Bài đã bình luận hoặc bấm <b>Đã xử lý</b> sẽ tự động chuyển vào đây và gắn đúng Sale phụ trách.
          </p>
        </div>
        <div className="module-actions">
          <button type="button" className="btn-cancel" onClick={() => setSettingsOpen(true)}>
            ⚙️ Cài đặt chấm điểm
          </button>
          {selectedItems.length ? (
            <button
              type="button"
              className="btn-cancel danger"
              disabled={busy}
              onClick={() => void onDeleteMany(selectedItems)}
            >
              {allSelected ? `Xoá hết (${selectedItems.length})` : `Xoá đã chọn (${selectedItems.length})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="lead-crm-filters">
        <input
          type="search"
          className="lead-crm-search"
          placeholder="Tìm tên, SĐT, nhu cầu, người xử lý..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <select
          className="lead-crm-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Tất cả trạng thái</option>
          {config.crmStatuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <label className="lead-crm-min-score">
          <span>Điểm từ</span>
          <input
            type="number"
            min={0}
            placeholder="0"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </label>
        {hasActiveFilter ? (
          <button type="button" className="btn-cancel lead-crm-clear-filter" onClick={clearFilters}>
            Bỏ lọc
          </button>
        ) : null}
      </div>

      <div className="lead-score-table-panel">
        <button
          type="button"
          className="lead-score-table-toggle"
          onClick={() => setShowScoreTable((v) => !v)}
        >
          {showScoreTable ? '▾' : '▸'} Bảng chấm điểm F-Solution
        </button>
        {showScoreTable ? (
          <table className="lead-score-table">
            <thead>
              <tr>
                <th>Điều kiện</th>
                <th>Điểm</th>
              </tr>
            </thead>
            <tbody>
              {SCORE_RULE_LABELS.map(({ key, label }) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td><b>+{config.scoreRules[key]}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="lead-level-summary">
        {config.levels.map((level) => {
          const active = levelFilter === level.id;
          const count = levelStats[level.id] || 0;
          return (
            <button
              key={level.id}
              type="button"
              className={`lead-level-card${active ? ' active' : ''}${count ? '' : ' empty'}`}
              style={
                {
                  '--lead-accent': level.color,
                  '--lead-bg': level.bg,
                } as CSSProperties
              }
              title={active ? 'Bỏ lọc mức này' : `Lọc ${level.label}`}
              onClick={() => toggleLevelFilter(level.id)}
            >
              <span className="lead-level-card-count">{count}</span>
              <span className="lead-level-card-label">{level.label}</span>
            </button>
          );
        })}
      </div>

      {hasActiveFilter ? (
        <p className="lead-crm-filter-meta">
          Hiển thị <b>{filteredRows.length}</b> / {rows.length} lead
        </p>
      ) : null}

      <div className="data-table-wrap">
        <table className="data-table lead-crm-table">
          <thead>
            <tr>
              <th className="select-col">
                {hasSelectableRows ? (
                  <input
                    type="checkbox"
                    title="Chọn tất cả"
                    disabled={busy}
                    checked={allSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                  />
                ) : null}
              </th>
              <th>Điểm</th>
              <th>Mức Lead</th>
              <th>Chi tiết điểm</th>
              <th>Người xử lý</th>
              <th>Thời gian xử lý</th>
              <th>Tên Facebook</th>
              <th>Nội dung nhu cầu</th>
              <th>Group</th>
              <th>Trạng thái</th>
              <th>Sale phụ trách</th>
              <th>SĐT</th>
              <th>Link bài viết</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredRows.length ? (
              filteredRows.map((item, idx) => {
                const canSelect = Boolean(item.lead_key && item.post_id);
                const key = canSelect ? selectionKey(item.post_id!, item.lead_key!) : '';
                const groupLabel = (item.group_id && groupNames[item.group_id]) || item.group_id || '-';
                const postLink = item.post_url || item.comment_url || '';
                return (
                  <tr key={`${item.lead_key || item.post_id}-${idx}`}>
                    <td className="select-col">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={Boolean(selected[key])}
                          onChange={(e) => toggleRow(item.post_id!, item.lead_key!, e.target.checked)}
                        />
                      ) : null}
                    </td>
                    <td className="lead-score-cell">
                      <b>{item.score ?? 0}</b>
                    </td>
                    <td>
                      <LeadLevelBadge
                        score={item.score || 0}
                        label={item.lead_level_label || ''}
                        config={config}
                      />
                    </td>
                    <td className="lead-breakdown-cell">
                      {item.score_breakdown?.length ? (
                        <ul className="lead-breakdown-list">
                          {item.score_breakdown.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="lead-breakdown-empty">—</span>
                      )}
                    </td>
                    <td>
                      <b>{item.processed_by || '-'}</b>
                    </td>
                    <td className="mono-cell">{formatLeadDateTime(item.processed_at)}</td>
                    <td>
                      <b>{item.name || 'Ẩn danh'}</b>
                    </td>
                    <td className="lead-need-cell">{item.need || '-'}</td>
                    <td>{groupLabel}</td>
                    <td>
                      <span className="lead-crm-status">{item.crm_status || '-'}</span>
                    </td>
                    <td>{item.assigned_sale || '-'}</td>
                    <td>{item.phone || '-'}</td>
                    <td>
                      {postLink ? (
                        <a href={postLink} target="_blank" rel="noreferrer">
                          Mở
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {canSelect ? (
                        <button
                          type="button"
                          className="table-icon-button danger"
                          title="Xoá"
                          disabled={busy}
                          onClick={() => void onDelete(item.post_id!, item.lead_key!, item.name)}
                        >
                          ✕
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={14} className="table-empty">
                  {rows.length
                    ? 'Không có lead phù hợp bộ lọc. Thử bỏ lọc hoặc đổi điều kiện.'
                    : 'Chưa có lead. Bình luận hoặc đánh dấu xử lý một bài viết để tự động tạo lead.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <LeadHunterSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) => {
          setConfig(next);
          setSelected({});
        }}
      />
    </section>
  );
}
