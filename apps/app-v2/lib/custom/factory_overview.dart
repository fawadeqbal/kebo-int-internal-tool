import 'package:flutter/material.dart' hide Badge;
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';

/// A factory at a glance: who to call (phone, email, WeChat id to copy), how they answer our
/// price requests, and what we still owe them (for people who handle payments).
class FactoryOverview extends StatefulWidget {
  const FactoryOverview(this.factory, {super.key, required this.title});
  final Factory factory;
  final String title;

  @override
  State<FactoryOverview> createState() => _FactoryOverviewState();
}

class _FactoryOverviewState extends State<FactoryOverview> {
  Json? owed;
  bool loaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded) _load();
  }

  Future<void> _load() async {
    Json? row;
    try {
      row = (await context.api.getList('/api/money/payables')).where((r) => r.at('factory.id') == widget.factory.id).firstOrNull;
    } on ApiException {
      // not allowed: no money here
    }
    if (mounted) {
      setState(() {
        owed = row;
        loaded = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.factory;
    final r = f.record;
    final o = owed;
    final cur = o?.str('currency');
    final wechat = f.wechat;
    return SectionCard(
      title: widget.title,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PhoneRow(
          RowData(
            title: f.contactPerson ?? 'No contact person yet',
            sub: [f.phone, f.email, if (wechat != null && wechat.isNotEmpty) 'WeChat $wechat'],
            actions: [ContactAction.phone(f.phone), ContactAction.email(f.email)],
          ),
          divider: false,
        ),
        if (wechat != null && wechat.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: wechat));
                if (context.mounted) toast(context, 'WeChat id copied: paste it in WeChat to add them');
              },
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy WeChat id'),
            ),
          ),
        if (r != null) ...[
          const SizedBox(height: Gap.sm),
          StatGrid([
            StatTile('Asked for prices', '${r.asked}', sub: '${r.answered} answered · ${r.declined} declined'),
            StatTile('Days to answer', r.avgDaysToAnswer == null ? '–' : '${r.avgDaysToAnswer}',
                sub: r.noReply > 0 ? '${r.noReply} never answered' : 'on average', tone: r.noReply > 0 ? Tone.warn : null),
            if (r.lateSteps > 0) StatTile('Late steps', '${r.lateSteps}', sub: 'on open orders', tone: Tone.bad),
          ]),
        ],
        if (o != null) ...[
          const SizedBox(height: Gap.md),
          KvRow('We owe them (with tax)', fmtMoney(o.str('owed'), cur) ?? '–'),
          KvRow('Paid', fmtMoney(o.str('paid'), cur) ?? '–'),
          KvRow('To pay', fmtMoney(o.str('toPay'), cur) ?? '–'),
        ],
      ]),
    );
  }
}
