import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/links.dart';
import '../../core/providers.dart';
import '../../design/design.dart';
import '../money/data/money_data.dart';

/// Payments and expenses sent for approval: approvers approve or send back with a reason;
/// people who sent them see where they stand.
final submissionsProvider = FutureProvider.autoDispose.family<Json, String>((ref, status) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return api.get('/api/submissions', query: {'status': status, 'pageSize': 50});
});

class ApprovalsScreen extends ConsumerStatefulWidget {
  const ApprovalsScreen({super.key});

  @override
  ConsumerState<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends ConsumerState<ApprovalsScreen> {
  String _status = 'pending';

  @override
  Widget build(BuildContext context) {
    final page = ref.watch(submissionsProvider(_status));
    final counts = page.value?.objAt('counts');
    String label(String k, String l) => (counts?.integer(k) ?? 0) > 0 ? '$l (${counts!.integer(k)})' : l;
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Approvals'),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(submissionsProvider(_status).future);
        },
        child: ListView(
          padding: const EdgeInsets.all(KSpace.s4),
          children: [
            KSegmented<String>(
              value: _status,
              onChanged: (v) => setState(() => _status = v),
              segments: [
                ('pending', label('pending', 'Waiting')),
                ('sent_back', label('sent_back', 'Sent back')),
                ('approved', 'Approved'),
              ],
            ),
            const SizedBox(height: KSpace.s4),
            switch (page) {
              AsyncValue(:final value?) when value.list('rows', (m) => m).isEmpty => KCard(
                child: KEmptyState(
                  icon: KIcons.shield,
                  title: _status == 'pending' ? 'Nothing waiting' : 'None here',
                  message: 'Payments and expenses sent for approval show here.',
                ),
              ),
              AsyncValue(:final value?) => KCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    for (final (i, r) in value.list('rows', (m) => m).indexed)
                      KListItem(
                        leading: KIcon(
                          r.str('kind') == 'payment' ? KIcons.arrowIn : KIcons.wallet,
                          color: context.k.inkMuted,
                        ),
                        title:
                            '${r.str('kind') == 'payment' ? 'Money received' : 'Expense'} · ${fmtMoney(r.strOrNull('amount'), r.strOrNull('currency')) ?? ''}',
                        subtitle: [
                          r.at('order.refNo'),
                          r.at('order.customer') ?? r.at('customer.name'),
                          r.strOrNull('description'),
                        ].whereType<String>().join(' · '),
                        meta: 'By ${r.at('submittedBy.name') ?? 'someone'} · ${fmtWhen(r.date('submittedAt'))}',
                        status: Wrap(
                          spacing: KSpace.s1,
                          children: [
                            if (r.boolean('hasFile')) const KBadge('Proof', tone: KTone.info),
                            if (r.boolAt('can.approve')) const KBadge('Yours to decide', tone: KTone.warning),
                          ],
                        ),
                        divider: i < value.list('rows', (m) => m).length - 1,
                        onPressed: () async {
                          final changed = await showKSheet<bool>(
                            context,
                            title: 'Approval',
                            builder: (_) => _Decide(s: r),
                          );
                          if (changed == true) ref.invalidate(submissionsProvider);
                        },
                      ),
                  ],
                ),
              ),
              AsyncValue(:final error?) => KBanner(error.toString(), tone: KTone.danger),
              _ => const KSkeleton(height: 160),
            },
          ],
        ),
      ),
    );
  }
}

class _Decide extends ConsumerStatefulWidget {
  const _Decide({required this.s});
  final Json s;

  @override
  ConsumerState<_Decide> createState() => _DecideState();
}

class _DecideState extends ConsumerState<_Decide> {
  final _reason = TextEditingController();
  bool _busy = false, _sendingBack = false;
  String? _done, _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Api get _api => ref.read(sessionProvider.notifier).api;

  Future<void> _go(Future<void> Function() call, String done) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await call();
      setState(() => _done = done);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    final b = s.objAt('body') ?? const <String, dynamic>{};
    final pay = s.str('kind') == 'payment';
    final cur = s.strOrNull('currency');
    if (_done != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s8),
        child: Center(
          child: SuccessCheck(label: _done!, onDone: () => Navigator.of(context).pop(true)),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        if (s.str('status') == 'sent_back' && s.strOrNull('reason') != null) ...[
          KBanner(
            s.str('reason'),
            tone: KTone.warning,
            title: 'Sent back by ${s.at('decidedBy.name') ?? 'the approver'}',
          ),
          const SizedBox(height: KSpace.s3),
        ],
        KDetails(
          columns: 1,
          items: [
            KDetail(pay ? 'Money received' : 'Expense', fmtMoney(s.strOrNull('amount'), cur), emphasis: true),
            if (pay) ...[
              KDetail('Order', [s.at('order.refNo'), s.at('order.customer')].whereType<String>().join(' · ')),
              KDetail('Received on', fmtDate(DateTime.tryParse(s.str('paidOn')))),
              KDetail('How', PaymentMethod.labels[s.strOrNull('method')] ?? s.strOrNull('method')),
              KDetail('Reference', s.strOrNull('reference')),
              KDetail('Bank charges', b['bankCharges'] == null ? null : fmtMoney('${b['bankCharges']}', cur)),
            ] else ...[
              KDetail('What', ExpenseCategory.labels[s.strOrNull('category')] ?? s.strOrNull('category')),
              KDetail('For', s.strOrNull('description')),
              KDetail('Spent on', fmtDate(DateTime.tryParse(s.str('spentOn')))),
              if (s.at('order.refNo') != null) KDetail('Order', s.at('order.refNo')),
            ],
            KDetail('Note', b['note'] as String?),
            KDetail('Sent by', '${s.at('submittedBy.name') ?? ''} · ${fmtDateTime(s.date('submittedAt')) ?? ''}'),
          ],
        ),
        const SizedBox(height: KSpace.s3),
        if (s.objAt('file') != null)
          KButton(
            'Open ${pay ? 'the slip' : 'the receipt'}',
            icon: KIcons.file,
            variant: KButtonVariant.secondary,
            fullWidth: true,
            onPressed: () => openFile(context, _api, '/api/files/${s.at('file.id')}', s.at('file.name') ?? 'proof'),
          )
        else
          const KBanner('No proof attached.', tone: KTone.warning),
        const SizedBox(height: KSpace.s5),
        if (s.boolAt('can.approve') && !_sendingBack) ...[
          KButton(
            pay ? 'Approve · the receipt is made' : 'Approve',
            fullWidth: true,
            loading: _busy,
            onPressed: () => _go(() => _api.post('/api/submissions/${s.str('id')}/approve', {}), 'Approved'),
          ),
          const SizedBox(height: KSpace.s2),
          KButton(
            'Send back',
            variant: KButtonVariant.tertiary,
            fullWidth: true,
            onPressed: _busy ? null : () => setState(() => _sendingBack = true),
          ),
        ],
        if (_sendingBack) ...[
          KTextField(
            label: 'Why',
            controller: _reason,
            multiline: true,
            hint: 'The amount on the slip is 18,900, not 19,280',
          ),
          const SizedBox(height: KSpace.s4),
          KButton(
            'Send back',
            variant: KButtonVariant.danger,
            fullWidth: true,
            loading: _busy,
            onPressed: () {
              if (_reason.text.trim().isEmpty) {
                setState(() => _error = 'Say why, so they can fix it.');
                return;
              }
              _go(
                () => _api.post('/api/submissions/${s.str('id')}/send-back', {'reason': _reason.text.trim()}),
                'Sent back',
              );
            },
          ),
        ],
        if (s.boolAt('can.withdraw')) ...[
          const SizedBox(height: KSpace.s2),
          KButton(
            'Withdraw',
            variant: KButtonVariant.tertiary,
            fullWidth: true,
            onPressed: _busy
                ? null
                : () => _go(() => _api.post('/api/submissions/${s.str('id')}/withdraw', {}), 'Withdrawn'),
          ),
        ],
      ],
    );
  }
}
