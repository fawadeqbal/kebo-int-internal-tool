import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});
  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  String _range = 'month';
  String _staff = '';

  @override
  Widget build(BuildContext context) {
    final meta = ref.watch(metaProvider).value ?? {};
    final cur = meta.s('currency', 'USD');
    final path = Uri(path: '/api/v1/reports', queryParameters: {'range': _range, if (_staff.isNotEmpty) 'staff': _staff}).toString();
    final data = ref.watch(getProvider(path));
    final presets = meta.m('reportRanges');
    return Scaffold(
      appBar: AppBar(title: const Text('Reports'), actions: [
        PdfButton(path: Uri(path: '/api/export/reports/pdf', queryParameters: {'range': _range, if (_staff.isNotEmpty) 'staff': _staff}).toString(), fileName: 'Business report ${f.today()}'),
      ]),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: ListView(padding: const EdgeInsets.fromLTRB(0, 8, 0, 32), children: [
          ChoiceChips<String>(
            value: _range,
            onChanged: (v) => setState(() => _range = v),
            options: [for (final e in presets.entries) if (e.key != 'custom') (e.key, e.value.toString())],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: SelectField<String>(
              label: 'Person',
              value: _staff,
              items: [('', 'Whole team'), for (final p in meta.l('people')) (p.s('id'), p.s('name'))],
              onChanged: (v) => setState(() => _staff = v ?? ''),
            ),
          ),
          data.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(getProvider(path))),
            data: (d) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: _Report(d: d, currency: cur)),
          ),
        ]),
      ),
    );
  }
}

class _Report extends StatelessWidget {
  const _Report({required this.d, required this.currency});
  final Json d;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final s = d.m('summary');
    final funnel = d.m('funnel');
    final money = d.m('finance');
    final range = d.m('range');
    final received = funnel.i('received');
    String pct(int n) => received == 0 ? '—' : '${(n * 100 / received).round()}%';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${f.date(range.s('from'))} – ${f.date(range.s('to'))}', style: context.t.bodySmall),
      gap12,
      if (d.mn('profit') != null) _Profit(p: d.m('profit'), target: d.n('targetMarginPercent', 15), staff: d.sn('staffId') != null),
      const Overline('Inquiries & money'),
      StatGrid([
        StatTile(label: 'Received', value: '${s.i('received')}', hint: 'new inquiries'),
        StatTile(label: 'Completed', value: '${s.i('completed')}', hint: '${s.i('notCompleted')} not completed', tone: Tone.ok),
        StatTile(label: 'Avg. turnaround', value: f.duration(s['avgTurnaroundMs'] as num?), hint: 'received → completed'),
        StatTile(label: 'Win rate', value: pct(funnel.i('accepted')), hint: 'accepted ÷ received'),
      ]),
      SectionCard(
        title: 'Conversion',
        subtitle: 'Inquiries received in the period, and how far they got',
        child: Column(children: [
          for (final (label, n) in [('Received', received), ('Quoted', funnel.i('quoted')), ('Accepted', funnel.i('accepted')), ('Invoiced', funnel.i('invoiced'))])
            _Bar(label: label, value: n, max: received, trailing: '$n · ${pct(n)}', color: context.c.primary),
        ]),
      ),
      SectionCard(
        title: 'Money',
        child: kv([
          ('Quoted (sent)', f.money(money['quotedSent'], currency)),
          ('Quotes accepted', f.money(money['quotedAccepted'], currency)),
          ('Invoiced', f.money(money['invoiced'], currency)),
          ('Received', f.money(money['received'], currency)),
          ('Outstanding now', f.money(money['outstanding'], currency)),
          ('Overdue now', f.money(money['overdue'], currency)),
        ]),
      ),
      SectionCard(title: 'Last 12 months', subtitle: 'Received vs completed', child: _Trend(rows: d.l('trend'))),
      SectionCard(
        title: 'Where inquiries came from',
        child: _Breakdown(rows: d.l('bySource'), label: (k) => sourceLabel[k] ?? k, color: context.c.charts[1]),
      ),
      SectionCard(
        title: 'Categories',
        child: _Breakdown(rows: d.l('byCategory'), label: (k) => k, color: context.c.charts[2]),
      ),
      SectionCard(
        title: 'Team',
        padding: EdgeInsets.zero,
        child: CardList(children: [
          for (final p in d.l('team'))
            RowTile(
              leading: Avatar(p.s('name'), size: 30),
              title: p.s('name'),
              subtitle: Text('${p.i('completed')} completed · ${p.i('notCompleted')} not completed · avg ${f.duration(p['avgMs'] as num?)}'),
              trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                ToneBadge('${p.i('open')} open', tone: Tone.info),
                if (p.i('overdue') > 0) Padding(padding: const EdgeInsets.only(top: 3), child: ToneBadge('${p.i('overdue')} overdue', tone: Tone.bad)),
              ]),
            ),
        ]),
      ),
    ]);
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.label, required this.value, required this.max, required this.trailing, required this.color});
  final String label;
  final int value, max;
  final String trailing;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [Expanded(child: Text(label, style: context.t.bodyMedium, overflow: TextOverflow.ellipsis)), Text(trailing, style: context.t.bodySmall!.copyWith(fontWeight: FontWeight.w600))]),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: max == 0 ? 0 : value / max, minHeight: 8, color: color, backgroundColor: context.c.surface3),
        ),
      ]),
    );
  }
}

class _Breakdown extends StatelessWidget {
  const _Breakdown({required this.rows, required this.label, required this.color});
  final List<Json> rows;
  final String Function(String) label;
  final Color color;
  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return Text('No inquiries in this period.', style: context.t.bodySmall);
    final max = rows.map((r) => r.i('n')).reduce((a, b) => a > b ? a : b);
    return Column(children: [for (final r in rows) _Bar(label: label(r.s('key')), value: r.i('n'), max: max, trailing: '${r.i('n')}', color: color)]);
  }
}

class _Trend extends StatelessWidget {
  const _Trend({required this.rows});
  final List<Json> rows;
  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final maxY = rows.fold<int>(1, (m, r) => [m, r.i('received'), r.i('completed')].reduce((a, b) => a > b ? a : b)).toDouble();
    LineChartBarData line(String key, Color color) => LineChartBarData(
          spots: [for (var i = 0; i < rows.length; i++) FlSpot(i.toDouble(), rows[i].i(key).toDouble())],
          isCurved: true,
          preventCurveOverShooting: true,
          color: color,
          barWidth: 2.5,
          dotData: const FlDotData(show: false),
          belowBarData: BarAreaData(show: key == 'received', color: color.withValues(alpha: 0.08)),
        );
    return Column(children: [
      SizedBox(
        height: 180,
        child: LineChart(LineChartData(
          minY: 0,
          maxY: (maxY * 1.15).ceilToDouble(),
          gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: c.line, strokeWidth: 1)),
          borderData: FlBorderData(show: false),
          lineTouchData: LineTouchData(
            touchTooltipData: LineTouchTooltipData(
              getTooltipColor: (_) => c.surface3,
              getTooltipItems: (spots) => [
                for (final s in spots)
                  LineTooltipItem('${s.barIndex == 0 ? 'Received' : 'Completed'}: ${s.y.toInt()}', TextStyle(fontFamily: 'Geist', fontSize: 12, color: c.text)),
              ],
            ),
          ),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 28, getTitlesWidget: (v, meta) => Text(v == meta.max ? '' : v.toInt().toString(), style: TextStyle(fontSize: 10.5, color: c.muted))),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                interval: 1,
                reservedSize: 22,
                getTitlesWidget: (v, _) {
                  final i = v.toInt();
                  if (i < 0 || i >= rows.length || (i % 2 == 1 && i != rows.length - 1)) return const SizedBox();
                  return Padding(padding: const EdgeInsets.only(top: 4), child: Text(rows[i].s('label'), style: TextStyle(fontSize: 10.5, color: c.muted)));
                },
              ),
            ),
          ),
          lineBarsData: [line('received', c.charts[0]), line('completed', c.charts[1])],
        )),
      ),
      gap8,
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        _Legend(color: c.charts[0], label: 'Received'),
        gap16,
        _Legend(color: c.charts[1], label: 'Completed'),
      ]),
    ]);
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 12, height: 3, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 6),
        Text(label, style: context.t.bodySmall),
      ]);
}


/* ---------------------------------------------------------------- Profit (for managers and admins) */

String _cents(num c, String cur) => f.cents(c.round(), cur);

class _Profit extends StatelessWidget {
  const _Profit({required this.p, required this.target, required this.staff});
  final Json p;
  final num target;
  final bool staff;

  Widget _margin(BuildContext context, Object? m) {
    if (m == null) return Text('—', style: context.t.bodySmall);
    final v = m is num ? m : num.tryParse(m.toString()) ?? 0;
    return Text('$v%', style: context.t.bodySmall!.copyWith(fontWeight: FontWeight.w600, color: v < 0 ? context.c.bad : v < target ? context.c.warn : context.c.ok));
  }

  @override
  Widget build(BuildContext context) {
    final cur = p.s('currency', 'USD');
    final inv = p.m('invoiced');
    final booked = p.m('booked');
    final waiting = p.m('waiting');
    String margin(Json t) => t['marginPercent'] == null ? 'no costs yet' : '${t['marginPercent']}% margin';
    final w = waiting.i('documents');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Profit', style: context.t.titleMedium),
      Text('After discounts, before tax. Costs include the factory\'s VAT. Target margin $target%.', style: context.t.bodySmall),
      gap12,
      StatGrid([
        StatTile(label: 'Gross profit', value: _cents(inv.n('profitCents'), cur), hint: margin(inv), tone: inv.n('profitCents') < 0 ? Tone.bad : Tone.ok),
        StatTile(label: 'Invoiced', value: _cents(inv.n('revenueCents'), cur), hint: 'cost ${_cents(inv.n('costCents'), cur)}'),
        StatTile(label: 'Booked profit', value: _cents(booked.n('profitCents'), cur), hint: '${booked.i('documents')} accepted · ${margin(booked)}'),
        StatTile(label: 'Waiting on customers', value: _cents(waiting.n('profitCents'), cur), hint: '$w ${w == 1 ? 'quote' : 'quotes'} sent'),
      ]),
      if (inv.n('uncostedRevenueCents') != 0)
        Notice('${_cents(inv.n('uncostedRevenueCents'), cur)} of what was invoiced has no recorded cost (freight, items priced by hand) and is not counted in the profit${inv['coveragePercent'] != null ? ' (${inv['coveragePercent']}% of revenue is costed)' : ''}.'),
      if (p.i('otherCurrencyInvoices') > 0) Notice('${p.i('otherCurrencyInvoices')} invoice(s) in other currencies are left out.'),
      SectionCard(title: 'Profit per month', subtitle: 'Invoiced vs gross profit, last 12 months', child: _ProfitTrend(rows: p.l('trend'))),
      _groups(context, 'By customer', p.l('byCustomer'), cur),
      _groups(context, 'By factory', p.l('byFactory'), cur),
      _groups(context, 'By category', p.l('byCategory'), cur),
      if (!staff) _groups(context, 'By person', p.l('byPerson'), cur),
      SectionCard(
        title: 'Thinnest margins',
        subtitle: 'Invoices to look at',
        padding: EdgeInsets.zero,
        child: p.l('thinnest').isEmpty
            ? Padding(padding: const EdgeInsets.all(16), child: Text('No costed invoices in this period.', style: context.t.bodySmall))
            : CardList(children: [
                for (final d in p.l('thinnest'))
                  RowTile(
                    title: d.s('customer'),
                    subtitle: Text(d.s('no'), style: mono13(context)),
                    trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(_cents(d.n('profitCents'), cur), style: context.t.titleSmall!.copyWith(color: d.n('profitCents') < 0 ? context.c.bad : null)),
                      _margin(context, d['marginPercent']),
                    ]),
                    onTap: () => context.push('/invoices/${d.s('id')}'),
                  ),
              ]),
      ),
    ]);
  }

  Widget _groups(BuildContext context, String title, List<Json> rows, String cur) => SectionCard(
        title: title,
        padding: EdgeInsets.zero,
        child: rows.isEmpty
            ? Padding(padding: const EdgeInsets.all(16), child: Text('Nothing invoiced in this period.', style: context.t.bodySmall))
            : CardList(children: [
                for (final g in rows)
                  RowTile(
                    title: g.s('key'),
                    subtitle: Text('Invoiced ${_cents(g.n('revenueCents'), cur)}'),
                    trailing: g.n('costedRevenueCents') > 0
                        ? Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text(_cents(g.n('profitCents'), cur), style: context.t.titleSmall!.copyWith(color: g.n('profitCents') < 0 ? context.c.bad : null)),
                            _margin(context, g['marginPercent']),
                          ])
                        : Text('No cost', style: context.t.bodySmall),
                  ),
              ]),
      );
}

class _ProfitTrend extends StatelessWidget {
  const _ProfitTrend({required this.rows});
  final List<Json> rows;
  @override
  Widget build(BuildContext context) {
    final c = context.c;
    if (rows.every((r) => r.n('revenue') == 0)) return Text('No invoices in the last 12 months yet.', style: context.t.bodySmall);
    final maxY = rows.fold<double>(1, (m, r) => [m, r.n('revenue').toDouble(), r.n('profit').toDouble()].reduce((a, b) => a > b ? a : b));
    final minY = rows.fold<double>(0, (m, r) => r.n('profit') < m ? r.n('profit').toDouble() : m);
    String compact(double v) => v.abs() >= 1e6 ? '${(v / 1e6).toStringAsFixed(1)}M' : v.abs() >= 1e3 ? '${(v / 1e3).toStringAsFixed(0)}k' : v.toStringAsFixed(0);
    return Column(children: [
      SizedBox(
        height: 180,
        child: BarChart(BarChartData(
          maxY: maxY * 1.1,
          minY: minY * 1.1,
          gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: c.line, strokeWidth: 1)),
          borderData: FlBorderData(show: false),
          barTouchData: BarTouchData(
            touchTooltipData: BarTouchTooltipData(
              getTooltipColor: (_) => c.surface3,
              getTooltipItem: (group, _, rod, i) => BarTooltipItem(
                '${rows[group.x].s('label')}\n${i == 0 ? 'Invoiced' : 'Profit'}: ${compact(rod.toY)}${i == 1 && rows[group.x]['margin'] != null ? ' · ${rows[group.x]['margin']}%' : ''}',
                TextStyle(fontFamily: 'Geist', fontSize: 12, color: c.text),
              ),
            ),
          ),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 38, getTitlesWidget: (v, meta) => Text(v == meta.max ? '' : compact(v), style: TextStyle(fontSize: 10.5, color: c.muted))),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 22,
                getTitlesWidget: (v, _) {
                  final i = v.toInt();
                  if (i < 0 || i >= rows.length || (i % 2 == 1 && i != rows.length - 1)) return const SizedBox();
                  return Padding(padding: const EdgeInsets.only(top: 4), child: Text(rows[i].s('label'), style: TextStyle(fontSize: 10.5, color: c.muted)));
                },
              ),
            ),
          ),
          barGroups: [
            for (var i = 0; i < rows.length; i++)
              BarChartGroupData(x: i, barsSpace: 2, barRods: [
                BarChartRodData(toY: rows[i].n('revenue').toDouble(), color: c.charts[0], width: 6, borderRadius: const BorderRadius.vertical(top: Radius.circular(2))),
                BarChartRodData(toY: rows[i].n('profit').toDouble(), color: c.charts[1], width: 6, borderRadius: const BorderRadius.vertical(top: Radius.circular(2))),
              ]),
          ],
        )),
      ),
      gap8,
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        _Legend(color: c.charts[0], label: 'Invoiced'),
        gap16,
        _Legend(color: c.charts[1], label: 'Gross profit'),
      ]),
    ]);
  }
}
