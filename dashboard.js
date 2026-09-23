/**
 * Torch-NPU Dashboard
 * 看板逻辑和图表渲染
 * P5 多仓：主 JSON 为 {meta, repos, aggregate} 三层结构——仓切换器按仓渲染，
 * "全仓汇总"视图消费 aggregate 段（跨仓去重口径，修订六）。
 */

// 全局数据存储（P5：主 JSON 三层结构）
let mainData = null;        // {meta, repos, aggregate, generated_at}
let currentRepoKey = null;  // 当前选中仓 repo_key，或 '__aggregate__'（全仓汇总）
let dashboardData = null;   // 当前仓的单仓数据（repos[repo_key]，结构与 P4 前一致）

const AGG_KEY = '__aggregate__';

// 修订六：当前趋势图的周轴覆盖仓标注（汇总视图 = aggregate.trends.covered_repos；
// 单仓视图 = null 不打扰）。createLineChart/createBarChart tooltip 消费。
let activeTrendCoverage = null;
let activeTrendWeeks = null;  // 周轴原始键（如 '2026-03-08'），与 coverage 查询对齐

/**
 * 修订六 tooltip 追加段：某周仅部分仓有批次时标注"仅覆盖 N/M 仓"
 * （周轴并集 + covered_repos 标注，不插值不静默合并）
 */
function appendCoverageTooltip(html, dataIndex) {
    if (!activeTrendCoverage || !activeTrendWeeks) return html;
    const origWeek = activeTrendWeeks[dataIndex];
    if (!origWeek) return html;
    const covered = activeTrendCoverage[origWeek] || [];
    const allRepos = (mainData && mainData.meta && mainData.meta.repos) || [];
    if (covered.length && covered.length < allRepos.length) {
        html += `<br/><span style="color:#F59E0B;font-size:12px;">仅覆盖 ${covered.length}/${allRepos.length} 仓</span>`;
    }
    return html;
}

/**
 * 初始化看板
 */
async function initDashboard() {
    console.log('[Dashboard] Initializing...');

    try {
        // 加载数据
        const response = await fetch('./dashboard_data.json?v=20260923101904');
        if (!response.ok) {
            throw new Error('Failed to load dashboard data');
        }

        mainData = await response.json();
        console.log('[Dashboard] Main data loaded:', mainData);

        // P5 三层结构（meta/repos/aggregate）——repos 段存放各仓数据。
        // 兼容旧单仓结构（P4 前主 JSON 直接是单仓数据）：无 meta 时按单仓直渲染。
        if (mainData && mainData.meta && mainData.meta.repos) {
            buildRepoSwitcher();
            // 默认选中"全仓汇总"（陛下 2026-09-18 口径）；aggregate 段
            // 无有效数据时（计算失败置空）回退有数据的仓——避免汇总视图
            // 渲染全空
            const agg = mainData.aggregate;
            const aggReady = !!(agg && agg.kpi && agg.kpi.week_ending);
            if (aggReady) {
                currentRepoKey = AGG_KEY;
            } else {
                const firstWithData = mainData.meta.repos.find(m => mainData.repos[m.repo_key]);
                currentRepoKey = firstWithData
                    ? firstWithData.repo_key
                    : (mainData.meta.repos[0] || {}).repo_key;
            }
            const select = document.getElementById('repo-switcher');
            if (select) select.value = currentRepoKey;
            switchRepo(currentRepoKey);
        } else {
            // 旧结构兜底：整个 JSON 即单仓数据（P4 及以前的镜像文件）
            console.log('[Dashboard] Legacy single-repo JSON detected');
            dashboardData = mainData;
            renderCurrentRepo();
        }

    } catch (error) {
        console.error('[Dashboard Error]', error);
        showError('数据加载失败，请确保已运行数据采集脚本');
    }
}

/**
 * P5：构建仓切换器 options（meta.repos 填充，追加"全仓汇总"）
 */
function buildRepoSwitcher() {
    const select = document.getElementById('repo-switcher');
    if (!select || !mainData || !mainData.meta) return;

    // 清空重建
    select.innerHTML = '';

    // 各仓 option（未采集过的仓标注"未采集"）
    // 陛下 2026-09-18 口径：切换器显示实际代码仓名（project_path，如
    // Ascend/pytorch）——display_name 是展示名，不再用于切换器
    mainData.meta.repos.forEach(m => {
        const hasData = !!(mainData.repos && mainData.repos[m.repo_key]);
        const opt = document.createElement('option');
        opt.value = m.repo_key;
        const label = m.project_path || m.display_name;
        opt.textContent = hasData ? label : `${label}（暂无看板数据）`;
        select.appendChild(opt);
    });

    // 追加"全仓汇总"
    const aggOpt = document.createElement('option');
    aggOpt.value = AGG_KEY;
    aggOpt.textContent = '全仓汇总';
    select.appendChild(aggOpt);
}

/**
 * P5：仓切换入口（select onchange）
 */
function switchRepo(repoKey) {
    currentRepoKey = repoKey;
    console.log('[Dashboard] Switching to repo:', repoKey);
    switchRepoRenderOnly();
}

/**
 * P5：按当前 currentRepoKey 渲染（不发起新 fetch——数据已全量在 mainData）
 */
function switchRepoRenderOnly() {
    // 修订六：周趋势覆盖仓标注——汇总视图挂 aggregate.trends.covered_repos，
    // 单仓视图清空（单仓周轴天然全覆盖，不打扰）
    activeTrendCoverage = null;
    activeTrendWeeks = null;

    if (currentRepoKey === AGG_KEY) {
        dashboardData = buildAggregateView();
        if (dashboardData && dashboardData.trends) {
            activeTrendCoverage = dashboardData.trends.covered_repos || null;
            // 汇总周轴为原始日期键（YYYY-MM-DD），与 coverage 查询对齐
            activeTrendWeeks = dashboardData.trends.weeks || null;
        }
    } else {
        dashboardData = (mainData.repos && mainData.repos[currentRepoKey]) || null;
    }

    if (!dashboardData) {
        // ecosystem 可能已有明细数据（P3 试抓）但无 weekly_metrics 批次——
        // 看板需全流程跑一次才有周指标，文案不写"尚未采集"避免误导
        showError('该仓暂无看板数据——先运行全流程采集: python src/main.py --repo <repo_key>');
        return;
    }

    renderCurrentRepo();
}

/**
 * P5：渲染当前 dashboardData（仓身份相关的动态元素在此更新）
 */
function renderCurrentRepo() {
    // 标题/Logo/页脚链接动态化（仓身份段）
    updateRepoIdentity();

    // 数据段渲染（与 P4 前渲染链一致）
    updateHeader();
    updateKPIs();
    updateTrendCharts();
    updateNewTrendCharts();
    updateDetailCards();
    updateQualityMetrics();
    updateMAUChart();
    updateFooter();
}

/**
 * P5：仓身份动态化——标题/Logo/页脚链接 + 汇总视图角标（author_id 覆盖率）
 */
function updateRepoIdentity() {
    const meta = mainData && mainData.meta;
    if (!meta || !meta.repos) return;

    let repoMeta = null;
    if (currentRepoKey === AGG_KEY) {
        // 汇总视图无单一仓链接——隐藏（Logo/标题不随此切换，见下方口径注释）
        repoMeta = { repo_url: null };
    } else {
        repoMeta = meta.repos.find(m => m.repo_key === currentRepoKey) || null;
    }

    const titleEl = document.getElementById('repo-title');
    if (titleEl && repoMeta) {
        // 陛下 2026-09-18 口径：看板标题保持默认仓名不变——不随仓选择/汇总视图切换
        titleEl.textContent = 'Ascend for PyTorch 社区运营看板';
    }

    const logoEl = document.getElementById('repo-logo');
    if (logoEl) {
        // 陛下 2026-09-18 口径：Logo 与标题同口径——恒显默认仓（首个 enabled）
        // Logo，不随仓选择/汇总视图切换（eco 仓未配 logo、汇总视图无单一
        // Logo 时不再隐藏——此前两场景左上角 Logo 消失）
        const defaultMeta = meta.repos[0];
        if (defaultMeta && defaultMeta.logo) {
            logoEl.src = defaultMeta.logo;
        }
        logoEl.style.display = '';
    }

    const linkEl = document.getElementById('repo-link');
    if (linkEl) {
        if (repoMeta && repoMeta.repo_url) {
            linkEl.href = repoMeta.repo_url;
            linkEl.style.display = '';
        } else {
            linkEl.style.display = 'none';
        }
    }
}

/**
 * P5：全仓汇总视图数据适配——把 aggregate 段适配为单仓渲染链的数据形状，
 * 并叠加 meta 的 targets（陛下拍板口径：全仓目标 = 各仓目标相加，
 * AggregateCalculator 已在 aggregate.kpi.targets 输出）。
 */
function buildAggregateView() {
    const agg = mainData && mainData.aggregate;
    if (!agg) return null;

    return {
        week_ending: agg.kpi && agg.kpi.week_ending,
        kpi: agg.kpi || {},
        issue_quality: agg.issue_quality || {},
        trends: agg.trends || {},
        download_trends: agg.download_trends || {},
        // 单人维度明细（P5 修复：aggregate 已跨仓合并输出——此前置空导致
        // Top10/新增名单全部显示 eco 单仓数据，汇总视图名不副实）
        top10_contributors: agg.top_contributors || [],
        new_contributors: agg.new_contributors || [],
        new_core_developers: agg.new_core_developers || [],
        long_open_issues: (agg.long_open_issues || []).map(i => ({
            ...i,
            title: `[${i.repo_display || i.repo}] ${i.title}`
        })),
        new_contributors_2026: (agg.kpi && agg.kpi.contributors && agg.kpi.contributors.new_2026) || 0,
        mau: agg.mau || { summary: {}, coverage: {} },
        generated_at: agg.generated_at,
        __aggregate__: true,  // 汇总视图标记（进度条目标值取 kpi.targets）
    };
}

/**
 * 更新头部信息
 */
function updateHeader() {
    if (!dashboardData) return;

    const periodRange = document.getElementById('period-range');
    if (periodRange && dashboardData.week_ending) {
        const endDate = new Date(dashboardData.week_ending);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);

        periodRange.textContent = `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
    }
}

/**
 * 更新 KPI 卡片
 */
function updateKPIs() {
    if (!dashboardData || !dashboardData.kpi) return;

    const kpi = dashboardData.kpi;

    // PR统计
    document.getElementById('kpi-pr-new').textContent = kpi.prs.new || 0;
    document.getElementById('kpi-pr-total').textContent = formatNumber(kpi.prs.total_2026 || 0);

    // Issue统计
    document.getElementById('kpi-issue-new').textContent = kpi.issues.new || 0;
    document.getElementById('kpi-issue-total').textContent = formatNumber(kpi.issues.total_all || 0);

    // 贡献者
    document.getElementById('kpi-contributor-new').textContent = kpi.contributors.new || 0;
    document.getElementById('kpi-contributor-2026').textContent = kpi.contributors.new_2026 || 0;
    document.getElementById('kpi-contributor-total').textContent = formatNumber(kpi.contributors.total || 0);

    // 核心开发者
    document.getElementById('kpi-core-new').textContent = kpi.core_developers.new || 0;
    document.getElementById('kpi-core-total').textContent = formatNumber(kpi.core_developers.total || 0);

    // 下载量
    document.getElementById('kpi-download-new').textContent = formatNumber(kpi.downloads.new || 0);
    document.getElementById('kpi-download-total').textContent = formatNumber(kpi.downloads.total || 0);

    // 更新目标进度条
    updateGoalProgress(kpi);
}

/**
 * 更新目标进度条
 * P5 修订五 B3：目标值不再硬编 2000/200——随 meta 注入（单仓=各自 targets，
 * 全仓汇总=各仓目标相加，即 aggregate.kpi.targets，陛下 2026-09-16 拍板口径）
 */
function updateGoalProgress(kpi) {
    // 目标值来源：汇总视图取 kpi.targets（各仓相加）；单仓取 meta.repos 注入
    let coreDevTarget = null;
    let contributorTarget = null;
    if (dashboardData && dashboardData.__aggregate__) {
        const t = (kpi && kpi.targets) || {};
        coreDevTarget = t.core_developers || null;
        contributorTarget = t.contributors || null;
    } else if (mainData && mainData.meta && mainData.meta.repos) {
        const m = mainData.meta.repos.find(m => m.repo_key === currentRepoKey);
        if (m && m.targets) {
            coreDevTarget = m.targets.core_developers || null;
            contributorTarget = m.targets.contributors || null;
        }
    }

    // 核心开发者目标进度
    const coreDevTotal = kpi.core_developers.total || 0;
    const coreDevPercent = coreDevTarget
        ? Math.min((coreDevTotal / coreDevTarget) * 100, 100) : 0;

    document.getElementById('core-dev-progress-text').textContent = formatNumber(coreDevTotal);
    document.getElementById('core-dev-percent').textContent = coreDevPercent.toFixed(1) + '%';
    // 目标值文本同步注入（B3：进度条详情 "/ 2000 人" 不再写死）
    const coreTargetText = document.getElementById('core-dev-target-text');
    if (coreTargetText) coreTargetText.textContent = formatNumber(coreDevTarget || 0);

    // 26年新增贡献者目标进度
    const contributorTotal = dashboardData.new_contributors_2026 || 0;
    const contributorPercent = contributorTarget
        ? Math.min((contributorTotal / contributorTarget) * 100, 100) : 0;

    document.getElementById('contributor-progress-text').textContent = formatNumber(contributorTotal);
    document.getElementById('contributor-percent').textContent = contributorPercent.toFixed(1) + '%';
    const contributorTargetText = document.getElementById('contributor-target-text');
    if (contributorTargetText) contributorTargetText.textContent = formatNumber(contributorTarget || 0);

    // 延迟执行动画，让用户能看到进度条从0增长的动画效果
    setTimeout(() => {
        document.getElementById('core-dev-progress-bar').style.width = coreDevPercent + '%';
        document.getElementById('contributor-progress-bar').style.width = contributorPercent + '%';
    }, 300);
}

/**
 * 更新趋势图表
 */
function updateTrendCharts() {
    if (!dashboardData || !dashboardData.trends) return;

    const trends = dashboardData.trends;
    const weeks = trends.weeks.map(w => formatShortDate(w));

    // 累计贡献者趋势
    createLineChart('chart-contributors', weeks, [
        { name: '累计贡献者', data: trends.total_contributors, color: '#3B82F6' }
    ]);

    // 累计核心开发者趋势
    createLineChart('chart-core-devs', weeks, [
        { name: '累计核心开发者', data: trends.total_core_devs || trends.total_core_developers, color: '#10B981' }
    ]);

    // 累计下载量趋势（使用日期维度数据，最近30天）
    if (dashboardData.download_trends && dashboardData.download_trends.dates.length > 0) {
        const downloadTrends = dashboardData.download_trends;
        createLineChart('chart-downloads', downloadTrends.dates, [
            { name: '累计下载量', data: downloadTrends.totals, color: '#8B5CF6' }
        ]);
    } else {
        // 如果没有日期维度数据，使用周数据作为 fallback
        createLineChart('chart-downloads', weeks, [
            { name: '累计下载量', data: trends.total_downloads, color: '#8B5CF6' }
        ]);
    }
}

/**
 * 更新新增趋势图表
 */
function updateNewTrendCharts() {
    if (!dashboardData || !dashboardData.trends) return;

    const trends = dashboardData.trends;
    const weeks = trends.weeks.map(w => formatShortDate(w));

    // 每周新增贡献者
    createBarChart('chart-new-contributors', weeks, [
        { name: '新增贡献者', data: trends.new_contributors, color: '#3B82F6' }
    ]);

    // 每周新增核心开发者
    createBarChart('chart-new-core-devs', weeks, [
        { name: '新增核心开发者', data: trends.new_core_devs || trends.new_core_developers, color: '#10B981' }
    ]);
}

/**
 * 创建折线图
 */
function createLineChart(containerId, xAxisData, seriesData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // P5 仓切换重渲染：先释放既有实例（否则 echarts 重复 init 告警且状态混乱）
    const existing = echarts.getInstanceByDom(container);
    if (existing) existing.dispose();

    const chart = echarts.init(container);

    const series = seriesData.map(s => ({
        name: s.name,
        type: 'line',
        smooth: true,
        data: s.data,
        itemStyle: { color: s.color },
        areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: s.color + '40' },
                { offset: 1, color: s.color + '05' }
            ])
        }
    }));

    const option = {
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: xAxisData,
            axisLine: { lineStyle: { color: '#64748B' } },
            axisLabel: { fontSize: 11 }
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#64748B', fontSize: 11 },
            splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } }
        },
        series: series,
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#E2E8F0',
            textStyle: { color: '#1E293B' },
            formatter: function(params) {
                // 修订六：汇总视图某周仅部分仓有批次时追加覆盖仓标注
                let html = params.map(p =>
                    `${p.marker}${p.seriesName}: <b>${p.value === null || p.value === undefined ? '暂无' : p.value}</b>`
                ).join('<br/>');
                return appendCoverageTooltip(html, params[0].dataIndex);
            }
        }
    };

    chart.setOption(option);

    // 响应式
    window.addEventListener('resize', () => chart.resize());
}

/**
 * 创建柱状图
 */
function createBarChart(containerId, xAxisData, seriesData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // P5 仓切换重渲染：先释放既有实例（否则 echarts 重复 init 告警且状态混乱）
    const existing = echarts.getInstanceByDom(container);
    if (existing) existing.dispose();

    const chart = echarts.init(container);

    const series = seriesData.map(s => ({
        name: s.name,
        type: 'bar',
        data: s.data,
        itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: s.color },
                { offset: 1, color: s.color + '80' }
            ]),
            borderRadius: [4, 4, 0, 0]
        }
    }));

    const option = {
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: xAxisData,
            axisLine: { lineStyle: { color: '#64748B' } },
            axisLabel: { fontSize: 11 }
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#64748B', fontSize: 11 },
            splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } }
        },
        series: series,
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#E2E8F0',
            textStyle: { color: '#1E293B' },
            formatter: function(params) {
                // 修订六：汇总视图某周仅部分仓有批次时追加覆盖仓标注
                let html = params.map(p =>
                    `${p.marker}${p.seriesName}: <b>${p.value === null || p.value === undefined ? '暂无' : p.value}</b>`
                ).join('<br/>');
                return appendCoverageTooltip(html, params[0].dataIndex);
            }
        }
    };

    chart.setOption(option);

    // 响应式
    window.addEventListener('resize', () => chart.resize());
}

/**
 * 更新详情卡片
 */
function updateDetailCards() {
    if (!dashboardData) return;

    console.log('[Dashboard] top10_contributors:', dashboardData.top10_contributors);
    console.log('[Dashboard] new_contributors:', dashboardData.new_contributors);

    // Top10 贡献者
    const top10List = document.getElementById('top10-list');
    if (top10List && dashboardData.top10_contributors) {
        console.log('[Dashboard] Rendering Top10, count:', dashboardData.top10_contributors.length);
        top10List.innerHTML = dashboardData.top10_contributors.slice(0, 10).map((item, index) => `
            <li>
                <span class="rank">${index + 1}</span>
                <span class="username">${item.nick_name || item.username}</span>
                <span class="count">${item.commit_count || 0} commits</span>
            </li>
        `).join('');
    } else {
        console.log('[Dashboard] Top10 not rendered, element:', top10List, 'data:', dashboardData.top10_contributors);
    }

    // 上周新增贡献者
    const newContributorsList = document.getElementById('new-contributors-list');
    if (newContributorsList && dashboardData.new_contributors) {
        console.log('[Dashboard] Rendering new contributors, count:', dashboardData.new_contributors.length);
        const contributors = dashboardData.new_contributors;
        newContributorsList.innerHTML = contributors.map(c => `
            <li>
                <span class="username">${c.nick_name || c.username}</span>
                <span class="count">${c.commit_count || 0} commits</span>
            </li>
        `).join('') || '<li style="color: #94A3B8;">无新增贡献者</li>';
    } else {
        console.log('[Dashboard] New contributors not rendered, element:', newContributorsList, 'data:', dashboardData.new_contributors);
    }

    // 上周新增核心开发者
    const newCoreDevsList = document.getElementById('new-core-devs-list');
    if (newCoreDevsList && dashboardData.new_core_developers) {
        const devs = dashboardData.new_core_developers;
        newCoreDevsList.innerHTML = devs.map(d => `
            <li>
                <span class="username">${d.nick_name || d.username}</span>
                <span class="count">${d.pr_count || 0} PR / ${d.issue_count || 0} Issue</span>
            </li>
        `).join('') || '<li style="color: #94A3B8;">无新增核心开发者</li>';
    }
}

/**
 * 更新质量指标
 */
function updateQualityMetrics() {
    if (!dashboardData || !dashboardData.issue_quality) return;

    const quality = dashboardData.issue_quality;

    // 全量平均关闭时长
    const avgCloseTimeAll = document.getElementById('avg-close-time-all');
    if (avgCloseTimeAll) avgCloseTimeAll.textContent = (quality.avg_close_time_all || 0).toFixed(1);

    // 26年平均关闭时长
    const avgCloseTime = document.getElementById('avg-close-time');
    const closeTimeProgress = document.getElementById('close-time-progress');
    const targetDays = document.getElementById('target-days');

    if (avgCloseTime) avgCloseTime.textContent = quality.avg_close_time.toFixed(1);
    if (targetDays) targetDays.textContent = quality.target_days;

    if (closeTimeProgress) {
        // 进度条：实际/目标，最大100%
        const progress = Math.min((quality.avg_close_time / quality.target_days) * 100, 100);
        closeTimeProgress.style.width = `${progress}%`;

        // 如果超过目标，改为红色
        if (quality.avg_close_time > quality.target_days) {
            closeTimeProgress.style.background = 'linear-gradient(90deg, #EF4444, #F87171)';
        }
    }

    // 全量解决率
    const resolutionRateAll = document.getElementById('resolution-rate-all');
    const resolutionProgressAll = document.getElementById('resolution-progress-all');
    const closedIssuesAll = document.getElementById('closed-issues-all');
    const totalIssuesAll = document.getElementById('total-issues-all');

    if (resolutionRateAll) resolutionRateAll.textContent = `${(quality.resolution_rate_all || 0).toFixed(1)}%`;
    if (resolutionProgressAll) resolutionProgressAll.style.width = `${quality.resolution_rate_all || 0}%`;
    if (closedIssuesAll) closedIssuesAll.textContent = quality.closed_issues_all || 0;
    if (totalIssuesAll) totalIssuesAll.textContent = quality.total_issues_all || 0;

    // 26年解决率
    const resolutionRate = document.getElementById('resolution-rate');
    const resolutionProgress = document.getElementById('resolution-progress');
    const closedIssues = document.getElementById('closed-issues');
    const totalIssues2026 = document.getElementById('total-issues-2026');

    if (resolutionRate) resolutionRate.textContent = `${quality.resolution_rate.toFixed(1)}%`;
    if (resolutionProgress) resolutionProgress.style.width = `${quality.resolution_rate}%`;
    if (closedIssues) closedIssues.textContent = quality.closed_issues_2026;
    if (totalIssues2026) totalIssues2026.textContent = quality.total_issues_2026;

    // 更新超过10天未闭环的Issue列表
    updateLongOpenIssues();
}

/**
 * 更新超过10天未闭环的Issue列表
 */
function updateLongOpenIssues() {
    const longOpenIssuesList = document.getElementById('long-open-issues-list');
    const longOpenIssuesCount = document.getElementById('long-open-issues-count');
    if (!longOpenIssuesList) return;

    // 获取超过10天未闭环的issue数据
    const longOpenIssues = dashboardData.long_open_issues || [];

    // 更新标题中的数量
    if (longOpenIssuesCount) {
        longOpenIssuesCount.textContent = longOpenIssues.length;
    }

    if (longOpenIssues.length === 0) {
        longOpenIssuesList.innerHTML = '<li style="color: #94A3B8; text-align: center;">暂无超过10天未闭环的Issue</li>';
        return;
    }

    // 按天数倒序排序
    const sortedIssues = longOpenIssues.sort((a, b) => b.open_days - a.open_days);

    longOpenIssuesList.innerHTML = sortedIssues.map(issue => `
        <li>
            <a href="${issue.issue_url}" target="_blank" class="issue-title" title="${issue.title}">#${issue.issue_id} ${issue.title}</a>
            <span class="issue-duration">${issue.open_days.toFixed(1)} 天</span>
        </li>
    `).join('');
}

/**
 * 更新页脚
 */
function updateFooter() {
    if (!dashboardData) return;

    const updateTime = document.getElementById('update-time');
    if (updateTime && dashboardData.generated_at) {
        const date = new Date(dashboardData.generated_at);
        updateTime.textContent = date.toLocaleString('zh-CN');
    }
}

/**
 * 格式化日期
 */
function formatDate(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 格式化短日期（用于图表）
 */
function formatShortDate(dateStr) {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 格式化数字（千分位）
 */
function formatNumber(num) {
    return num.toLocaleString('zh-CN');
}

/**
 * 显示错误信息
 */
function showError(message) {
    const dashboard = document.querySelector('.dashboard');
    if (dashboard) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.cssText = `
            background: #FEE2E2;
            color: #DC2626;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            text-align: center;
        `;
        errorDiv.textContent = message;
        dashboard.insertBefore(errorDiv, dashboard.firstChild);
    }
}

/**
 * 更新月活统计图表
 * 修订五 A4（必修，2027 跨年雷修复）：月份轴不再写死 `2026-` 前缀——由
 * mau.summary 实际键动态生成（数据有哪几个月画哪几个月，跨年自然支持），
 * 当前月高亮用 currentMonthStr 与键对比（不再假设年份）。
 */
function updateMAUChart() {
    if (!dashboardData || !dashboardData.mau || !dashboardData.mau.summary) {
        console.log('[Dashboard] No MAU data available');
        const container = document.getElementById('chart-mau');
        if (container) {
            container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94A3B8;font-size:14px;">暂无数据</div>';
        }
        return;
    }

    const summary = dashboardData.mau.summary;
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentYear = new Date().getFullYear();
    const currentMonthStr = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;

    // 修订五 A4：月份轴由 summary 实际键动态生成（升序），跨年键如
    // 2027-01 正常渲染——不再写死 2026 前缀
    const monthKeys = Object.keys(summary).sort();
    const months = [];
    const values = [];

    monthKeys.forEach(key => {
        // 键形如 YYYY-MM；展示"YYYY年M月"（跨年时年份可辨）
        const [y, m] = key.split('-');
        months.push(`${parseInt(y)}年${parseInt(m)}月`);
        values.push(summary[key] !== undefined ? summary[key] : null);
    });

    const container = document.getElementById('chart-mau');
    if (!container) return;

    const chart = echarts.init(container);

    const option = {
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: months,
            axisLine: { lineStyle: { color: '#64748B' } },
            axisLabel: { fontSize: 12 },
            axisTick: { alignWithLabel: true }
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#64748B', fontSize: 12 },
            splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } }
        },
        series: [
            {
                name: '月活人数',
                type: 'bar',
                data: values,
                barWidth: '50%',
                itemStyle: {
                    borderRadius: [4, 4, 0, 0],
                    color: function(params) {
                        // 修订五 A4：高亮判断用实际月键与当前月对比（不拼年份前缀）
                        const monthStr = monthKeys[params.dataIndex];
                        if (monthStr === currentMonthStr) {
                            return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                { offset: 0, color: '#F59E0B' },
                                { offset: 1, color: '#F59E0B80' }
                            ]);
                        }
                        return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: '#3B82F6' },
                            { offset: 1, color: '#3B82F680' }
                        ]);
                    }
                },
                label: {
                    show: true,
                    position: 'top',
                    formatter: function(params) {
                        return params.value !== null && params.value !== undefined ? params.value + ' 人' : '';
                    },
                    color: '#1E293B',
                    fontSize: 13,
                    fontWeight: 'bold',
                    distance: 8
                }
            }
        ],
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#E2E8F0',
            textStyle: { color: '#1E293B' },
            formatter: function(params) {
                const p = params[0];
                if (p.value === null || p.value === undefined) return p.name + '<br/>暂无数据';
                let html = p.name + '<br/>' + p.value + ' 人';
                // P5 汇总视图：MAU 月份 coverage 标注（该月仅部分仓有数据时提示）
                const coverage = dashboardData.mau && dashboardData.mau.coverage;
                if (dashboardData.__aggregate__ && coverage) {
                    const monthKey = monthKeys[p.dataIndex];
                    const covered = coverage[monthKey] || [];
                    const allRepos = (mainData && mainData.meta && mainData.meta.repos) || [];
                    if (covered.length && covered.length < allRepos.length) {
                        html += `<br/><span style="color:#F59E0B;font-size:12px;">仅覆盖 ${covered.length}/${allRepos.length} 仓</span>`;
                    }
                }
                return html;
            }
        }
    };

    chart.setOption(option);
    window.addEventListener('resize', () => chart.resize());
}

/**
 * 导出月活详细数据为 Excel
 */
function exportMAUData() {
    if (!dashboardData || !dashboardData.mau || !dashboardData.mau.details || dashboardData.mau.details.length === 0) {
        alert('暂无月活数据可导出');
        return;
    }

    const details = dashboardData.mau.details;
    // P5 汇总视图：明细为跨仓同人同月合并行（数值 SUM）——多"参与仓"列区分
    const isAgg = !!dashboardData.__aggregate__ && details.some(r => r.repos);
    const headers = isAgg
        ? ['月份', '开发者ID', '开发者姓名', '开发者昵称', 'PR合入数', 'PR评论数', 'Issue提交数', 'Issue评论数', '参与仓']
        : ['月份', '开发者ID', '开发者姓名', '开发者昵称', 'PR合入数', 'PR评论数', 'Issue提交数', 'Issue评论数'];
    const rows = details.map(r => {
        const base = [
            r.month,
            r.author_id,
            r.author_name,
            r.author_nickname,
            r.pr_num,
            r.pr_comments_num,
            r.issue_num,
            r.issue_comments_num
        ];
        if (isAgg) base.push((r.repos || []).join(', '));
        return base;
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '月活详细数据');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const filename = `社区月活详细数据_${dateStr}.xlsx`;

    XLSX.writeFile(workbook, filename);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initDashboard);
