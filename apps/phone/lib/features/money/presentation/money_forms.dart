import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/outbox.dart';
import '../../../core/picker.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/money_data.dart';
import 'proof_field.dart';

/// Money a customer sent for an order, with the slip. People who record payments make the
/// receipt at once; others send it to a manager. With no signal both wait on the phone and
/// go in order later (the slip follows the new payment). True when saved.
Future<bool> openMoneyReceived(
  BuildContext context, {
  required String orderId,
  required String refNo,
  required String currency,
  String? due,
}) async {
  final r = await showKSheet<bool>(
    context,
    title: 'Money received · $refNo',
    builder: (_) => _MoneyIn(orderId: orderId, refNo: refNo, currency: currency, due: due),
  );
  return r == true;
}

class _MoneyIn extends ConsumerStatefulWidget {
  const _MoneyIn({required this.orderId, required this.refNo, required this.currency, this.due});
  final String orderId, refNo, currency;
  final String? due;

  @override
  ConsumerState<_MoneyIn> createState() => _MoneyInState();
}

class _MoneyInState extends ConsumerState<_MoneyIn> {
  late final _amount = TextEditingController(text: (num.tryParse(widget.due ?? '') ?? 0) > 0 ? widget.due : '');
  final _ref = TextEditingController();
  final _charges = TextEditingController();
  final _note = TextEditingController();
  DateTime _on = CompanyTime.today();
  String _method = 'bank_transfer';
  String? _accountId;
  PickedFile? _slip;
  bool _busy = false, _done = false;
  String? _problem;
  Map<String, String> _fields = const {};

  @override
  void dispose() {
    for (final c in [_amount, _ref, _charges, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(bool direct) async {
    if ((num.tryParse(_amount.text.trim()) ?? 0) <= 0) {
      KHaptics.error();
      setState(() => _fields = {'receivedAmount': 'Enter the amount received.'});
      return;
    }
    setState(() {
      _busy = true;
      _problem = null;
      _fields = const {};
    });
    final s = ref.read(sessionProvider.notifier);
    final body = <String, Object?>{
      'currency': widget.currency,
      'receivedCurrency': widget.currency,
      'receivedAmount': _amount.text.trim(),
      'paidOn': isoDay(_on),
      'method': _method,
      if (_charges.text.trim().isNotEmpty) 'bankCharges': _charges.text.trim(),
      if (_ref.text.trim().isNotEmpty) 'reference': _ref.text.trim(),
      if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      'accountId': ?_accountId,
    };
    try {
      final ch = s.outbox.chain('Money received · ${widget.refNo} · ${fmtMoney(_amount.text.trim(), widget.currency)}');
      final made = direct
          ? ch.post('/api/orders/${widget.orderId}/payments', body, idAt: 'createdId')
          : ch.post('/api/submissions', {'kind': 'payment', 'orderId': widget.orderId, 'body': body}, idAt: 'id');
      if (_slip != null) {
        ch.upload(
          direct ? '/api/payments/${Chain.ref(made)}/file' : '/api/submissions/${Chain.ref(made)}/file',
          _slip!.bytes,
          _slip!.name,
        );
      }
      final sent = await ch.send();
      if (!mounted) return;
      if (sent.queued) {
        showKToast(context, 'Saved on this phone. It is sent when you are back online.', icon: KIcons.wifiOff);
        Navigator.of(context).pop(true);
        return;
      }
      setState(() => _done = true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _problem = e.fieldErrors.isEmpty ? e.message : null;
          _fields = e.fieldErrors;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final direct = s.can(permRecord);
    if (_done) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s8),
        child: Center(
          child: SuccessCheck(
            label: direct ? 'Recorded. The receipt is made.' : 'Sent for approval',
            onDone: () => Navigator.of(context).pop(true),
          ),
        ),
      );
    }
    final accounts = direct
        ? ref.watch(accountsProvider).value?.where((a) => a.currency == widget.currency).toList() ?? const <Account>[]
        : const <Account>[];
    if (_accountId == null && accounts.length == 1) _accountId = accounts.first.id;
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!direct) ...[
          const KBanner('You add it; a manager approves it. It counts once approved.'),
          const SizedBox(height: KSpace.s4),
        ],
        if (_problem != null) ...[KBanner(_problem!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        KTextField(
          label: 'Amount received',
          controller: _amount,
          prefix: widget.currency,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          help: widget.due == null ? null : 'Still due on this order: ${fmtMoney(widget.due, widget.currency)}',
          error: _fields['receivedAmount'] ?? _fields['amount'],
        ),
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'Received on',
          value: fmtDate(_on),
          icon: KIcons.calendar,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _on,
              firstDate: DateTime(2020),
              lastDate: CompanyTime.today(),
            );
            if (d != null) setState(() => _on = d);
          },
        ),
        const SizedBox(height: KSpace.s4),
        Text('How', style: KType.label.copyWith(color: c.ink)),
        const SizedBox(height: KSpace.s2),
        Wrap(
          spacing: KSpace.s2,
          runSpacing: KSpace.s2,
          children: [
            for (final e in PaymentMethod.labels.entries.where((e) => e.key != 'letter_of_credit'))
              KChip(e.value, selected: _method == e.key, onPressed: () => setState(() => _method = e.key)),
          ],
        ),
        if (accounts.isNotEmpty) ...[
          const SizedBox(height: KSpace.s4),
          Text('Into', style: KType.label.copyWith(color: c.ink)),
          for (final a in accounts)
            KRadio<String>(
              label: a.name,
              help: a.kind,
              value: a.id,
              group: _accountId,
              onChanged: (v) => setState(() => _accountId = v),
            ),
        ],
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'Reference',
          controller: _ref,
          optional: true,
          hint: 'MT103 or transfer number',
          error: _fields['reference'],
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'Bank charges',
          controller: _charges,
          optional: true,
          prefix: widget.currency,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          help: 'Taken by the banks on the way.',
        ),
        const SizedBox(height: KSpace.s4),
        ProofField(
          label: 'Payment slip',
          help: 'Verifiers need it. A photo of the slip is enough.',
          onChanged: (f) => _slip = f,
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(label: 'Note', controller: _note, optional: true, multiline: true),
        const SizedBox(height: KSpace.s6),
        KButton(
          direct ? 'Record · a receipt is made' : 'Send for approval',
          fullWidth: true,
          loading: _busy,
          onPressed: () => _save(direct),
        ),
      ],
    );
  }
}

/// An expense, with its receipt. Optionally on an order.
Future<bool> openExpense(BuildContext context, {String? orderId, String? refNo}) async {
  final r = await showKSheet<bool>(
    context,
    title: refNo == null ? 'Add an expense' : 'Expense · $refNo',
    builder: (_) => _Expense(orderId: orderId, refNo: refNo),
  );
  return r == true;
}

class _Expense extends ConsumerStatefulWidget {
  const _Expense({this.orderId, this.refNo});
  final String? orderId, refNo;

  @override
  ConsumerState<_Expense> createState() => _ExpenseState();
}

class _ExpenseState extends ConsumerState<_Expense> {
  final _what = TextEditingController();
  final _amount = TextEditingController();
  String? _category;
  String? _currency;
  DateTime _on = CompanyTime.today();
  PickedFile? _receipt;
  bool _busy = false, _done = false;
  Map<String, String> _fields = const {};
  String? _problem;

  @override
  void dispose() {
    _what.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save(bool direct, String currency) async {
    final f = <String, String>{
      if (_category == null) 'category': 'Choose what it was.',
      if (_what.text.trim().isEmpty) 'description': 'Say what it was for.',
      if ((num.tryParse(_amount.text.trim()) ?? 0) <= 0) 'amount': 'The amount must be more than 0.',
    };
    if (f.isNotEmpty) {
      KHaptics.error();
      setState(() => _fields = f);
      return;
    }
    setState(() {
      _busy = true;
      _fields = const {};
      _problem = null;
    });
    final body = <String, Object?>{
      'category': _category,
      'description': _what.text.trim(),
      'amount': _amount.text.trim(),
      'currency': currency,
      'spentOn': isoDay(_on),
      'orderId': ?widget.orderId,
    };
    try {
      final s = ref.read(sessionProvider.notifier);
      final ch = s.outbox.chain('Expense · ${_what.text.trim()} · ${fmtMoney(_amount.text.trim(), currency)}');
      final made = direct
          ? ch.post('/api/expenses', body, idAt: 'id')
          : ch.post('/api/submissions', {'kind': 'expense', 'orderId': ?widget.orderId, 'body': body}, idAt: 'id');
      if (_receipt != null) {
        ch.upload(
          direct ? '/api/expenses/${Chain.ref(made)}/receipt' : '/api/submissions/${Chain.ref(made)}/file',
          _receipt!.bytes,
          _receipt!.name,
        );
      }
      final sent = await ch.send();
      if (!mounted) return;
      if (sent.queued) {
        showKToast(context, 'Saved on this phone. It is sent when you are back online.', icon: KIcons.wifiOff);
        Navigator.of(context).pop(true);
        return;
      }
      setState(() => _done = true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _fields = e.fieldErrors;
          _problem = e.fieldErrors.isEmpty ? e.message : null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final direct = s.can(permExpenses);
    final currency = _currency ?? ref.watch(homeCurrencyProvider).value ?? 'USD';
    if (_done) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s8),
        child: Center(
          child: SuccessCheck(
            label: direct ? 'Expense added' : 'Sent for approval',
            onDone: () => Navigator.of(context).pop(true),
          ),
        ),
      );
    }
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!direct) ...[
          const KBanner('You add it; a manager approves it. It counts once approved.'),
          const SizedBox(height: KSpace.s4),
        ],
        if (_problem != null) ...[KBanner(_problem!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        Text('What was it', style: KType.label.copyWith(color: c.ink)),
        const SizedBox(height: KSpace.s2),
        Wrap(
          spacing: KSpace.s2,
          runSpacing: KSpace.s2,
          children: [
            for (final e in ExpenseCategory.labels.entries)
              KChip(e.value, selected: _category == e.key, onPressed: () => setState(() => _category = e.key)),
          ],
        ),
        if (_fields['category'] != null)
          Padding(
            padding: const EdgeInsets.only(top: KSpace.s1),
            child: Text(_fields['category']!, style: KType.footnote.copyWith(color: c.danger)),
          ),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'For',
          controller: _what,
          hint: 'Taxi to the supplier in Ningbo',
          error: _fields['description'],
        ),
        const SizedBox(height: KSpace.s4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 2,
              child: KTextField(
                label: 'Amount',
                controller: _amount,
                prefix: currency,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                error: _fields['amount'],
              ),
            ),
            const SizedBox(width: KSpace.s3),
            Expanded(
              child: KSelectField(
                label: 'Currency',
                value: currency,
                onTap: () async {
                  final v = await showKSheet<String>(
                    context,
                    title: 'Currency',
                    builder: (ctx) => Column(
                      children: [
                        for (final cur in ['USD', 'CNY', 'EUR', 'PKR', 'AFN', 'AED'])
                          KListItem(
                            title: cur,
                            chevron: false,
                            onPressed: () => Navigator.pop(ctx, cur),
                            trailing: cur == currency ? KIcon(KIcons.check, color: ctx.k.primary) : null,
                          ),
                      ],
                    ),
                  );
                  if (v != null) setState(() => _currency = v);
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'Spent on',
          value: fmtDate(_on),
          icon: KIcons.calendar,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _on,
              firstDate: DateTime(2020),
              lastDate: CompanyTime.today(),
            );
            if (d != null) setState(() => _on = d);
          },
        ),
        const SizedBox(height: KSpace.s4),
        ProofField(label: 'Receipt', help: 'A photo of the receipt or bill.', onChanged: (f) => _receipt = f),
        const SizedBox(height: KSpace.s6),
        KButton(
          direct ? 'Add expense' : 'Send for approval',
          fullWidth: true,
          loading: _busy,
          onPressed: () => _save(direct, currency),
        ),
      ],
    );
  }
}
