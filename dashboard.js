/**
 * Torch-NPU Dashboard
 * 看板逻辑和图表渲染
 */

// 全局数据存储
let dashboardData = null;

/**
 * 初始化看板
 */
async function initDashboard() {
    console.log('[Dashboard] Initializing...');

    try {
        // 加载数据
        const response = await fetch('./dashboard_data.json?v=20260831170728');
        if (!response.ok) {
            throw new Error('Failed to load dashboard data');
        }

        dashboardData = await response.json();
        console.log('[Dashboard] Data loaded:', dashboardData);

        // 更新页面
        updateHeader();
        updateKPIs();
        updateTrendCharts();
        updateNewTrendCharts();
        updateDetailCards();
        updateQualityMetrics();
        updateMAUChart();
        updateFooter();

    } catch (error) {
        console.error('[Dashboard Error]', error);
        showError('数据加载失败，请确保已运行数据采集脚本');
    }
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
 */
function updateGoalProgress(kpi) {
    // 核心开发者目标：2000人
    const coreDevTarget = 2000;
    const coreDevTotal = kpi.core_developers.total || 0;
    const coreDevPercent = Math.min((coreDevTotal / coreDevTarget) * 100, 100);

    document.getElementById('core-dev-progress-text').textContent = formatNumber(coreDevTotal);
    document.getElementById('core-dev-percent').textContent = coreDevPercent.toFixed(1) + '%';

    // 26年新增贡献者目标：200人
    const contributorTarget = 200;
    const contributorTotal = dashboardData.new_contributors_2026 || 0;
    const contributorPercent = Math.min((contributorTotal / contributorTarget) * 100, 100);

    document.getElementById('contributor-progress-text').textContent = formatNumber(contributorTotal);
    document.getElementById('contributor-percent').textContent = contributorPercent.toFixed(1) + '%';

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
            textStyle: { color: '#1E293B' }
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
            textStyle: { color: '#1E293B' }
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

    const months = [];
    const values = [];

    for (let m = 1; m <= 12; m++) {
        const monthStr = `2026-${m.toString().padStart(2, '0')}`;
        months.push(`${m}月`);
        values.push(summary[monthStr] !== undefined ? summary[monthStr] : null);
    }

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
                        const monthIndex = params.dataIndex + 1;
                        const monthStr = `2026-${monthIndex.toString().padStart(2, '0')}`;
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
                return p.name + '<br/>' + p.value + ' 人';
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
    const headers = ['月份', '开发者ID', '开发者姓名', '开发者昵称', 'PR合入数', 'PR评论数', 'Issue提交数', 'Issue评论数'];
    const rows = details.map(r => [
        r.month,
        r.author_id,
        r.author_name,
        r.author_nickname,
        r.pr_num,
        r.pr_comments_num,
        r.issue_num,
        r.issue_comments_num
    ]);

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
