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

/// Pay a factory for one of its orders, with the bank slip. [payable] is a row of
/// /money/payables (the factory, its currency, and the orders with what is still to pay).
Future<bool> openPayFactory(BuildContext context, Json payable) async {
  final orders = payable.list('orders', (m) => m);
  Json? order = orders.length == 1 ? orders.first : null;
  order ??= await showKSheet<Json>(
    context,
    title: 'Pay ${payable.at('factory.name') ?? 'the factory'} for',
    builder: (ctx) => Column(
      children: [
        for (final (i, o) in orders.indexed)
          KListItem(
            title: o.str('refNo'),
            subtitle: '${o.str('customer')} · ${o.str('word')}',
            meta: o.at('next.label'),
            trailing: Text(
              fmtMoney(o.strOrNull('toPay'), payable.strOrNull('currency')) ?? '',
              style: KType.bodyStrong.copyWith(color: ctx.k.ink),
            ),
            divider: i < orders.length - 1,
            onPressed: () => Navigator.pop(ctx, o),
          ),
      ],
    ),
  );
  if (order == null || !context.mounted) return false;
  final r = await showKSheet<bool>(
    context,
    title: 'Pay ${payable.at('factory.name') ?? 'factory'} · ${order.str('refNo')}',
    builder: (_) => _PayFactory(payable: payable, order: order!),
  );
  return r == true;
}

class _PayFactory extends ConsumerStatefulWidget {
  const _PayFactory({required this.payable, required this.order});
  final Json payable, order;

  @override
  ConsumerState<_PayFactory> createState() => _PayFactoryState();
}

class _PayFactoryState extends ConsumerState<_PayFactory> {
  late final _amount = TextEditingController(text: widget.order.strOrNull('toPay'));
  final _ref = TextEditingController();
  final _note = TextEditingController();
  String _kind = 'deposit';
  String _method = 'bank_transfer';
  DateTime _on = CompanyTime.today();
  String? _accountId;
  PickedFile? _slip;
  bool _busy = false, _done = false;
  String? _error;
  Map<String, String> _fields = const {};

  String get _cur => widget.payable.str('currency', 'USD');

  @override
  void dispose() {
    for (final c in [_amount, _ref, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if ((num.tryParse(_amount.text.trim()) ?? 0) <= 0) {
      KHaptics.error();
      setState(() => _fields = {'amount': 'The amount must be more than 0.'});
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fields = const {};
    });
    try {
      final s = ref.read(sessionProvider.notifier);
      final ch = s.outbox.chain(
        'Paid ${widget.payable.at('factory.name')} · ${widget.order.str('refNo')} · ${fmtMoney(_amount.text.trim(), _cur)}',
      );
      final made = ch.post('/api/orders/${widget.order.str('id')}/factory-payments', {
        'factoryId': widget.payable.at('factory.id'),
        'kind': _kind,
        'amount': _amount.text.trim(),
        'currency': _cur,
        'paidOn': isoDay(_on),
        'method': _method,
        if (_ref.text.trim().isNotEmpty) 'reference': _ref.text.trim(),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        'accountId': ?_accountId,
      }, idAt: 'createdId');
      if (_slip != null) ch.upload('/api/factory-payments/${Chain.ref(made)}/file', _slip!.bytes, _slip!.name);
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
          _error = e.fieldErrors.isEmpty ? e.message : null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_done) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s8),
        child: Center(
          child: SuccessCheck(label: 'Payment to the factory recorded', onDone: () => Navigator.of(context).pop(true)),
        ),
      );
    }
    final c = context.k;
    final accounts = ref.watch(accountsProvider).value?.where((a) => a.currency == _cur).toList() ?? const <Account>[];
    if (_accountId == null && accounts.length == 1) _accountId = accounts.first.id;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        Text('For', style: KType.label.copyWith(color: c.ink)),
        const SizedBox(height: KSpace.s2),
        KSegmented<String>(
          value: _kind,
          onChanged: (v) => setState(() => _kind = v),
          segments: const [('deposit', 'Advance'), ('balance', 'Balance'), ('other', 'Other')],
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'Amount paid',
          controller: _amount,
          prefix: _cur,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          help: 'Still to pay on this order: ${fmtMoney(widget.order.strOrNull('toPay'), _cur)}',
          error: _fields['amount'],
        ),
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'Paid on',
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
        Wrap(
          spacing: KSpace.s2,
          runSpacing: KSpace.s2,
          children: [
            for (final e in PaymentMethod.labels.entries)
              KChip(e.value, selected: _method == e.key, onPressed: () => setState(() => _method = e.key)),
          ],
        ),
        if (accounts.isNotEmpty) ...[
          const SizedBox(height: KSpace.s4),
          Text('From', style: KType.label.copyWith(color: c.ink)),
          for (final a in accounts)
            KRadio<String>(
              label: a.name,
              help: a.balance == null ? null : 'Balance ${fmtMoney(a.balance, a.currency)}',
              value: a.id,
              group: _accountId,
              onChanged: (v) => setState(() => _accountId = v),
            ),
        ],
        const SizedBox(height: KSpace.s4),
        KTextField(label: 'Reference', controller: _ref, optional: true, hint: 'TT number'),
        const SizedBox(height: KSpace.s4),
        ProofField(
          label: 'Bank slip',
          help: 'The transfer slip or the factory\'s receipt.',
          onChanged: (f) => _slip = f,
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(label: 'Note', controller: _note, optional: true, multiline: true),
        const SizedBox(height: KSpace.s6),
        KButton('Record payment', fullWidth: true, loading: _busy, onPressed: _save),
      ],
    );
  }
}

/// Move money between two of our accounts (a bank to cash, an exchange).
Future<bool> openTransfer(BuildContext context, List<Account> accounts) async {
  final r = await showKSheet<bool>(
    context,
    title: 'Move money',
    builder: (_) => _Transfer(accounts: accounts),
  );
  return r == true;
}

class _Transfer extends ConsumerStatefulWidget {
  const _Transfer({required this.accounts});
  final List<Account> accounts;

  @override
  ConsumerState<_Transfer> createState() => _TransferState();
}

class _TransferState extends ConsumerState<_Transfer> {
  Account? _from, _to;
  final _out = TextEditingController();
  final _in = TextEditingController();
  final _ref = TextEditingController();
  DateTime _on = CompanyTime.today();
  bool _busy = false, _done = false;
  String? _error;
  Map<String, String> _fields = const {};

  @override
  void dispose() {
    for (final c in [_out, _in, _ref]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _exchange => _from != null && _to != null && _from!.currency != _to!.currency;

  Future<Account?> _pick(String title, Account? not) => showKSheet<Account>(
    context,
    title: title,
    builder: (ctx) => Column(
      children: [
        for (final a in widget.accounts.where((a) => a.id != not?.id))
          KListItem(
            title: a.name,
            subtitle: '${a.currency}${a.balance == null ? '' : ' · ${fmtMoney(a.balance, a.currency)}'}',
            chevron: false,
            onPressed: () => Navigator.pop(ctx, a),
          ),
      ],
    ),
  );

  Future<void> _save() async {
    final f = <String, String>{
      if (_from == null) 'fromAccountId': 'Choose where the money left.',
      if (_to == null) 'toAccountId': 'Choose where it arrived.',
      if ((num.tryParse(_out.text.trim()) ?? 0) <= 0) 'amountOut': 'The amount must be more than 0.',
      if (_exchange && (num.tryParse(_in.text.trim()) ?? 0) <= 0) 'amountIn': 'How much arrived, in ${_to?.currency}.',
    };
    if (f.isNotEmpty) {
      KHaptics.error();
      setState(() => _fields = f);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fields = const {};
    });
    try {
      final s = ref.read(sessionProvider.notifier);
      final ch = s.outbox.chain('Moved ${fmtMoney(_out.text.trim(), _from!.currency)} · ${_from!.name} → ${_to!.name}');
      ch.post('/api/money/transfers', {
        'fromAccountId': _from!.id,
        'toAccountId': _to!.id,
        'amountOut': _out.text.trim(),
        if (_exchange) 'amountIn': _in.text.trim(),
        'transferredOn': isoDay(_on),
        if (_ref.text.trim().isNotEmpty) 'reference': _ref.text.trim(),
      });
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
          _error = e.fieldErrors.isEmpty ? e.message : null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_done) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s8),
        child: Center(
          child: SuccessCheck(label: 'Money moved', onDone: () => Navigator.of(context).pop(true)),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        KSelectField(
          label: 'From',
          value: _from?.name,
          placeholder: 'Choose an account',
          error: _fields['fromAccountId'],
          onTap: () async {
            final a = await _pick('From', _to);
            if (a != null) setState(() => _from = a);
          },
        ),
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'To',
          value: _to?.name,
          placeholder: 'Choose an account',
          error: _fields['toAccountId'],
          onTap: () async {
            final a = await _pick('To', _from);
            if (a != null) setState(() => _to = a);
          },
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'Amount',
          controller: _out,
          prefix: _from?.currency,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          error: _fields['amountOut'],
        ),
        if (_exchange) ...[
          const SizedBox(height: KSpace.s4),
          KTextField(
            label: 'Arrived',
            controller: _in,
            prefix: _to!.currency,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            help: 'Different currencies: what arrived after the exchange.',
            error: _fields['amountIn'],
          ),
        ],
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'On',
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
        KTextField(label: 'Reference', controller: _ref, optional: true),
        const SizedBox(height: KSpace.s6),
        KButton('Move money', fullWidth: true, loading: _busy, onPressed: _save),
      ],
    );
  }
}
