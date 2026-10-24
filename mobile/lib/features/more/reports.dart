import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
