const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'data', 'walkthrough.csv');
const templatePath = path.join(root, 'templates', 'index.template.html');
const outputPath = path.join(root, 'index.html');

const statusColors = ['#8B5CF6', '#40E0D0', '#8AF06A', '#6B7280', '#6F7BFF', '#FF5C8A', '#FFCC66', '#A78BFA'];
const priorityColors = {
  P0: '#FF5C8A',
  P1: '#FFCC66',
  P2: '#7C8CFF',
  P3: '#40E0D0',
  Unspecified: '#A78BFA',
};
const categoryColors = {
  Bugs: '#FF5C8A',
  UI: '#40E0D0',
  UX: '#A78BFA',
  Unspecified: '#7C8CFF',
};

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => String(value).trim()));
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_-]/g, ' ');
}

function getField(row, names) {
  for (const name of names) {
    const key = normalizeKey(name);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return '';
}

function clean(value, fallback = 'Unspecified') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeStatus(value) {
  return clean(value);
}

function normalizePriority(value) {
  const text = clean(value).toUpperCase();
  return ['P0', 'P1', 'P2', 'P3'].includes(text) ? text : clean(value);
}

function normalizeDate(value) {
  const text = clean(value);
  if (text === 'Unspecified') return text;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return text;
}

function isClosedStatus(status) {
  return ['release', 'released', 'done', 'closed', 'resolved', 'cancel', 'cancelled', 'canceled'].includes(
    String(status || '').trim().toLowerCase()
  );
}

function isActiveStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return value && value !== 'unspecified' && !isClosedStatus(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, ' ');
}

function percent(count, total) {
  return total ? `${((count / total) * 100).toFixed(1)}%` : '0.0%';
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const value = clean(item[field]);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function preferredEntries(counts, preferred) {
  const seen = new Set();
  const entries = [];
  for (const key of preferred) {
    if (counts.has(key)) {
      entries.push([key, counts.get(key)]);
      seen.add(key);
    }
  }
  for (const entry of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (!seen.has(entry[0])) entries.push(entry);
  }
  return entries;
}

function labelCn(value) {
  return value === 'Unspecified' ? '未指定' : value;
}

function barRows(entries, colors) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return entries
    .map(([name, count]) => {
      const color = colors[name] || '#A78BFA';
      const width = ((count / max) * 100).toFixed(1);
      return `<div class="bar-row"><div class="bar-label"><span class="cn">${escapeHtml(labelCn(name))}</span><span class="en">${escapeHtml(name)}</span></div><div class="bar-track"><i style="width:${width}%;background:linear-gradient(90deg,${color},#40E0D0)"></i></div><b>${count}</b></div>`;
    })
    .join('\n');
}

function trendRows(entries) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return entries
    .map(([date, count]) => {
      const width = ((count / max) * 100).toFixed(1);
      return `<div class="trend-row"><span>${escapeHtml(date)}</span><div class="bar-track"><i style="width:${width}%"></i></div><b>${count}</b></div>`;
    })
    .join('\n');
}

function conicGradient(entries, total) {
  if (!total) return '#6B7280 0deg 360deg';
  let angle = 0;
  return entries
    .map(([, count], index) => {
      const nextAngle = angle + (count / total) * 360;
      const segment = `${statusColors[index % statusColors.length]} ${angle.toFixed(1)}deg ${nextAngle.toFixed(1)}deg`;
      angle = nextAngle;
      return segment;
    })
    .join(',');
}

function textIndex(item) {
  return [
    item.issue,
    item.status,
    item.priority,
    item.category,
    item.reporter,
    item.date,
    item.descriptionCn,
    item.descriptionEn,
  ]
    .join(' ')
    .toLowerCase();
}

function renderQueue(items) {
  if (!items.length) {
    return `<article class="queue-card"><div class="queue-top"><strong>No P0</strong><span class="pill danger">P0</span></div><p><span class="cn">当前 CSV 中没有 P0 项。</span><span class="en">No P0 items are present in the current CSV.</span></p></article>`;
  }

  return items
    .map(
      (item) => `<article class="queue-card" data-text="${escapeAttr(textIndex(item))}" data-status="${escapeAttr(item.status)}" data-priority="${escapeAttr(item.priority)}" data-category="${escapeAttr(item.category)}">
      <div class="queue-top"><strong>${escapeHtml(item.issue)}</strong><span class="pill danger">${escapeHtml(item.priority)}</span></div>
      <p><span class="cn">${escapeHtml(item.descriptionCn)}</span><span class="en">${escapeHtml(item.descriptionEn)}</span></p>
      <div class="chips"><span>${escapeHtml(item.status)}</span><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.date)}</span></div>
    </article>`
    )
    .join('\n');
}

function renderOptions(values) {
  return values.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
}

function renderTableRows(items) {
  return items
    .map(
      (item) => `<tr data-text="${escapeAttr(textIndex(item))}" data-status="${escapeAttr(item.status)}" data-priority="${escapeAttr(item.priority)}" data-category="${escapeAttr(item.category)}">
<td>${escapeHtml(item.issue)}</td><td><span class="tag status">${escapeHtml(item.status)}</span></td><td><span class="tag priority">${escapeHtml(item.priority)}</span></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.reporter)}</td><td>${escapeHtml(item.date)}</td><td class="desc"><span class="cn">${escapeHtml(item.descriptionCn)}</span><span class="en">${escapeHtml(item.descriptionEn)}</span></td>
</tr>`
    )
    .join('\n');
}

function rowsFromCsv() {
  const csv = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csv);
  const headers = rows.shift().map(normalizeKey);

  return rows.map((cells) => {
    const raw = {};
    headers.forEach((header, index) => {
      raw[header] = cells[index] || '';
    });

    const issue = clean(getField(raw, ['Issue key', 'Issue Key', 'Issue', 'Issue id', 'Issue ID', 'Key']), 'Unknown');
    const status = normalizeStatus(getField(raw, ['Status']));
    const priority = normalizePriority(getField(raw, ['Priority']));
    const reporter = clean(getField(raw, ['Reporter', 'Assignee', 'Owner']));
    const date = normalizeDate(getField(raw, ['Submitted Date', 'Submitted date', 'Date', 'Created', 'Created Date']));
    const category = clean(getField(raw, ['Category', 'Type']));
    const descriptionCn = clean(getField(raw, ['中文描述', 'Chinese Description', 'Description CN', '描述', '功能描述', 'Description']), '');
    const descriptionEn = clean(getField(raw, ['English Description', 'English description', 'Description EN', 'EN Description']), descriptionCn);

    return { issue, status, priority, reporter, date, category, descriptionCn, descriptionEn };
  });
}

function renderSections(items) {
  const total = items.length;
  const statusEntries = preferredEntries(countBy(items, 'status'), ['Backlog', 'Progressing', 'Release', 'Cancel', 'Unspecified']);
  const priorityEntries = preferredEntries(countBy(items, 'priority'), ['P0', 'P1', 'P2', 'P3', 'Unspecified']);
  const categoryEntries = preferredEntries(countBy(items, 'category'), ['Bugs', 'UI', 'UX', 'Unspecified']);
  const trendEntries = [...countBy(items.filter((item) => item.date !== 'Unspecified'), 'date').entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const p0Items = items.filter((item) => item.priority === 'P0');

  const legendRows = statusEntries
    .map(([name, count], index) => `<div class="legend-row"><i style="background:${statusColors[index % statusColors.length]}"></i><span class="cn">${escapeHtml(labelCn(name))} (${percent(count, total)})</span><span class="en">${escapeHtml(name)} (${percent(count, total)})</span><b>${count}</b></div>`)
    .join('\n');

  const statusOptions = preferredEntries(countBy(items, 'status'), ['Backlog', 'Progressing', 'Release', 'Cancel', 'Unspecified']).map(([name]) => name);
  const priorityOptions = priorityEntries.map(([name]) => name);
  const categoryOptions = categoryEntries.map(([name]) => name);

  return `<section class="grid charts">
 <div class="card"><span class="badge-small"><span class="cn">状态</span><span class="en">Status</span></span><h3 class="section-title"><span class="cn">状态分布</span><span class="en">Status Distribution</span></h3><div class="section-sub">Issue <span class="cn">生命周期拆分</span><span class="en">lifecycle split</span></div><div class="donut-wrap"><div class="donut" style="background:conic-gradient(${conicGradient(statusEntries, total)})"><div class="donut-center"><div><b>${total}</b><span><span class="cn">总数</span><span class="en">Total</span></span></div></div></div><div class="legend">${legendRows}</div></div></div>
 <div class="card"><span class="badge-small"><span class="cn">优先级</span><span class="en">Priority</span></span><h3 class="section-title"><span class="cn">优先级堆栈</span><span class="en">Priority Stack</span></h3><div class="section-sub"><span class="cn">按优先级拆分风险严重度</span><span class="en">Risk severity by priority</span></div>${barRows(priorityEntries, priorityColors)}</div>
 <div class="card"><span class="badge-small"><span class="cn">类别</span><span class="en">Category</span></span><h3 class="section-title"><span class="cn">类别构成</span><span class="en">Category Mix</span></h3><div class="section-sub">Bugs / UI / UX <span class="cn">集中度</span><span class="en">concentration</span></div>${barRows(categoryEntries, categoryColors)}</div>
</section>
<section class="grid mid"><div class="card"><span class="badge-small"><span class="cn">趋势</span><span class="en">Trend</span></span><h3 class="section-title"><span class="cn">提交趋势</span><span class="en">Submission Trend</span></h3><div class="section-sub"><span class="cn">每日 issue 提报量</span><span class="en">Daily issue submissions</span></div>${trendRows(trendEntries)}</div><div class="card queue"><span class="badge-small">P0</span><h3 class="section-title"><span class="cn">P0 最高优先级处理清单</span><span class="en">P0 Highest-priority Queue</span></h3><div class="section-sub"><span class="cn">只展示表格中的 P0 项，描述来自表格描述字段</span><span class="en">Only P0 items are shown; descriptions come from the sheet fields</span></div><div class="queue-list">${renderQueue(p0Items)}</div></div></section>
<section class="card matrix"><span class="badge-small">${total} <span class="cn">行</span><span class="en">rows</span></span><h3 class="section-title">Issue <span class="cn">明细矩阵</span><span class="en">Detail Matrix</span></h3><div class="section-sub"><span class="cn">静态内嵌数据，移动端即使禁用脚本也会显示</span><span class="en">Static embedded data, visible on mobile even if scripts are blocked</span></div><div class="filters"><input id="q" placeholder="搜索 issue / 状态 / 优先级 / 提报人 / 描述…"><select id="status"><option value=""><span class="cn">全部状态</span>All Status</option>${renderOptions(statusOptions)}</select><select id="priority"><option value="">All Priority</option>${renderOptions(priorityOptions)}</select><select id="category"><option value="">All Category</option>${renderOptions(categoryOptions)}</select></div><div class="table-scroll"><table id="matrix"><thead><tr><th>Issue</th><th><span class="cn">状态</span><span class="en">Status</span></th><th><span class="cn">优先级</span><span class="en">Priority</span></th><th><span class="cn">类别</span><span class="en">Category</span></th><th><span class="cn">提报人</span><span class="en">Reporter</span></th><th><span class="cn">日期</span><span class="en">Date</span></th><th><span class="cn">功能描述</span><span class="en">Description</span></th></tr></thead><tbody>${renderTableRows(items)}</tbody></table></div></section>`;
}

function renderHeroPills(items) {
  const total = items.length;
  const active = items.filter((item) => isActiveStatus(item.status)).length;
  const bugs = items.filter((item) => item.category === 'Bugs').length;
  const p0p1Open = items.filter((item) => ['P0', 'P1'].includes(item.priority) && !isClosedStatus(item.status)).length;

  return `<div class="mini-pills"><span><i class="dot"></i><span class="cn">待办 ${percent(active, total)}</span><span class="en">Open ${percent(active, total)}</span></span><span><i class="dot" style="background:var(--cyan)"></i><span class="cn">缺陷 ${percent(bugs, total)}</span><span class="en">Bugs ${percent(bugs, total)}</span></span><span><i class="dot" style="background:var(--pink)"></i>P0/P1 ${percent(p0p1Open, total)}</span></div>`;
}

function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing CSV: ${csvPath}`);
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing template: ${templatePath}`);
  }

  const items = rowsFromCsv();
  const template = fs.readFileSync(templatePath, 'utf8');
  const html = template
    .replace('{{HERO_MINI_PILLS}}', renderHeroPills(items))
    .replace('{{GENERATED_SECTIONS}}', renderSections(items));

  fs.writeFileSync(outputPath, html);
  console.log(`Generated index.html from ${items.length} CSV rows.`);
}

main();
