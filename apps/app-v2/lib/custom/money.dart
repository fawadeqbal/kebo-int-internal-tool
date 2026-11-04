import 'package:flutter/material.dart' hide Badge;
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import '../generated/models.g.dart';
import 'waiting.dart';

// Who may do what with money (the server checks the same).
const permRecord = 'payments.record';
const permExpenses = 'expenses.manage';
const permSubmit = 'money.submit';

/// Records money received now, or sends it to a manager.
bool canAddMoney(BuildContext c) => c.can(permRecord) || c.can(permSubmit);
bool canAddExpense(BuildContext c) => c.can(permExpenses) || c.can(permSubmit);

String _today() => isoDay(DateTime.now())!;
num _n(Object? v) => num.tryParse('${v ?? ''}'.replaceAll(',', '').trim()) ?? 0;
String _fixed(num v) => v.toStringAsFixed(2);

/// "due 10 Nov 2026", "on the ready date", "paid".
String? _dueText(Json row) {
  final d = row.strOrNull('dueOn') ?? row.strOrNull('due');
  if (row.str('status') == 'paid') return 'paid';
  if (d != null) return 'due ${fmtDate(DateTime.parse(d))}';
  return row.strOrNull('rule') ??
      switch (row.strOrNull('dueRule')) {
        'on_order' => 'when the factory order is placed',
        'on_ready' => 'on the ready date',
        _ => null,
      };
}

// ---------------------------------------------------------------- rates and accounts

/// Units of [from] for one [to], from the company's rates in Settings (null when one is missing).
Future<double?> rateOf(Api api, String from, String to) async {
  if (from == to) return 1;
  try {
    final s = await api.get('/api/settings');
    final base = s.at('sales.currency') ?? 'USD';
    final rates = s.objAt('sales.exchangeRates') ?? const {};
    double? r(String c) => c == base ? 1 : (rates[c] as num?)?.toDouble();
    final a = r(from), b = r(to);
    return a == null || b == null || b == 0 ? null : a / b;
  } on ApiException {
    return null;
  }
}

/// Our accounts by currency (id → name); empty when the cash book is off or not allowed.
Future<Map<String, Map<String, String>>> _accounts(Api api) async {
  try {
    final out = <String, Map<String, String>>{};
    for (final a in await api.getList('/api/money/accounts')) {
      if (a.boolean('archived')) continue;
      (out[a.str('currency')] ??= {})[a.str('id')] = a.str('name');
    }
    return out;
  } on ApiException {
    return const {};
  }
}

/// One "Into" / "Paid from" field per currency: only the one for the chosen currency shows.
List<FieldDef> _accountFields(Map<String, Map<String, String>> byCurrency, String currencyKey, String label) => [
  for (final e in byCurrency.entries)
    FieldDef('accountId', label, FieldKind.choice, options: e.value, showIf: (v) => v[currencyKey] == e.key),
];

String _lastAccount(Map<String, Map<String, String>> byCurrency, String currency) =>
    byCurrency[currency]?.length == 1 ? byCurrency[currency]!.keys.first : '';

/// The numbers the papers carry, by paper key (`payment-receipt:<id>` → "RC-2026-0447-2").
/// A payment's own `receiptNo` is only its place in the order (1, 2…).
Future<Map<String, String>> paperNumbers(Api api, String orderId) async {
  try {
    final j = await api.get('/api/orders/$orderId/papers');
    return {
      for (final p in j.list('papers', (m) => m))
        if (p.strOrNull('number') != null) p.str('key'): p.str('number'),
    };
  } on ApiException {
    return const {};
  }
}

// ---------------------------------------------------------------- send now or for approval

/// Records it (people who may) or sends it to a manager; then the photo follows. With no signal
/// both wait on the phone and go in order later (the photo follows the new id).
Future<Sent> _recordOrSubmit(
  Outbox box, {
  required String label,
  required bool direct,
  required String kind,
  required String? orderId,
  required String path,
  required String idAt,
  required Json body,
  required PickedFile? file,
  required String Function(String id) fileTo,
}) {
  final ch = box.chain(label);
  final made = direct
      ? ch.post(path, body, idAt: idAt)
      : ch.post('/api/submissions', {'kind': kind, 'orderId': ?orderId, 'body': body}, idAt: 'id');
  if (file != null) ch.upload(direct ? fileTo(Chain.ref(made)) : '/api/submissions/${Chain.ref(made)}/file', file.bytes, file.name);
  return ch.send();
}

const _approvalNote = 'You add it; a manager approves it. It counts once approved.';

// ---------------------------------------------------------------- money received

/// Money a customer sent, with the bank slip. People who record payments make the receipt at once;
/// others send it to a manager. True when saved or sent.
Future<bool> openMoneyReceived(
  BuildContext context, {
  required String orderId,
  required String refNo,
  String? customer,
}) async {
  final api = context.api;
  final direct = context.can(permRecord);
  final Json money, pays;
  final Map<String, Map<String, String>> accounts;
  try {
    final r = await Future.wait([api.get('/api/orders/$orderId/money'), api.get('/api/orders/$orderId/payments')]);
    money = r[0];
    pays = r[1];
    accounts = direct ? await _accounts(api) : const {};
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return false;
  }
  if (!context.mounted) return false;
  final cur = money.str('currency');
  final due = _n(pays.strOrNull('due') ?? money.strOrNull('due'));
  final next = money.objAt('plan.next');
  final open = next == null ? due : _n(next['open']);
  final settingsRate = <String, double?>{};
  final isLc = money.at('route.route') == 'letter_of_credit';
  PickedFile? slip;
  Sent? sent;
  final box = context.outbox;

  final fields = <FieldDef>[
    FieldDef(
      'receivedCurrency',
      'Currency that arrived',
      FieldKind.choice,
      required: true,
      options: CurrencyEnum.labels,
    ),
    const FieldDef('receivedAmount', 'Amount received', FieldKind.decimal, required: true),
    FieldDef(
      'rate',
      'Rate',
      FieldKind.decimal,
      required: true,
      hint: 'How many of the money that arrived make one $cur',
      showIf: (v) => v['receivedCurrency'] != cur,
    ),
    const FieldDef('paidOn', 'Received on', FieldKind.date, required: true),
    FieldDef(
      'bankCharges',
      'Bank charges ($cur)',
      FieldKind.decimal,
      hint: 'What the banks kept; it still counts as paid',
    ),
    FieldDef('method', 'How', FieldKind.choice, options: PaymentMethodEnum.labels, defaultValue: 'bank_transfer'),
    ..._accountFields(accounts, 'receivedCurrency', 'Into'),
    const FieldDef('reference', 'Reference', FieldKind.text, max: 120, hint: 'MT103 or transfer number'),
  ];
  final more = <FieldDef>[
    const FieldDef(
      'paidByName',
      'Paid by',
      FieldKind.text,
      max: 120,
      hint: 'Someone paying for the customer, e.g. their agent',
    ),
    if (isLc) const FieldDef('bankStep', 'Money reached us (the LC paid)', FieldKind.toggle),
    const FieldDef('note', 'Note', FieldKind.multiline, max: 2000),
  ];

  final ok = await FormSheet.open(
    context,
    title: 'Money received',
    save: direct ? 'Record · a receipt is made' : 'Send for approval',
    keeps: true,
    intro: joinParts([
      refNo,
      customer,
      if (next != null)
        '${next.str('label').toLowerCase()} ${fmtMoney(next.str('open'), cur)} ${_dueText(next) ?? ''}'.trim()
      else
        'due ${fmtMoney(_fixed(due), cur)}',
      if (!direct) '\n$_approvalNote',
    ]),
    initial: {
      'receivedCurrency': cur,
      'receivedAmount': open > 0 ? _fixed(open) : '',
      'paidOn': _today(),
      'bankCharges': '',
      'method': isLc ? 'letter_of_credit' : 'bank_transfer',
      'accountId': _lastAccount(accounts, cur),
      if (isLc) 'bankStep': true,
    },
    groups: [
      FormGroup(fields: fields),
      FormGroup(title: 'More', fields: more, folded: true),
    ],
    onChange: (v, key) async {
      if (key != 'receivedCurrency') return;
      final c = v['receivedCurrency'] as String;
      v['accountId'] = _lastAccount(accounts, c);
      if (c == cur) return;
      final r = settingsRate[c] ??= await rateOf(api, c, cur);
      if (r != null && _n(v['rate']) == 0) v['rate'] = r.toStringAsFixed(r >= 10 ? 4 : 6);
    },
    live: (v) {
      final rate = v['receivedCurrency'] == cur ? 1 : _n(v['rate']);
      final counts = (rate > 0 ? _n(v['receivedAmount']) / rate : 0) + _n(v['bankCharges']);
      final left = due - counts;
      return _Summary(
        rows: [
          ('Still due', fmtMoney(_fixed(due), cur)!),
          ('This counts', fmtMoney(_fixed(counts), cur)!),
          if (left >= 0) ('Left due', fmtMoney(_fixed(left), cur)!),
        ],
        note: left < 0
            ? '${fmtMoney(_fixed(-left), cur)} more than due · kept as ${customer ?? "the customer"}\'s credit'
            : null,
      );
    },
    extra: (setState) => FileTile(
      label: 'Bank slip',
      add: 'Snap the slip or attach it',
      hint: 'A photo or PDF of the transfer',
      picked: slip,
      onPicked: (p) => setState(() => slip = p),
    ),
    send: (api, body) async {
      final b = {...body, 'currency': cur};
      if (b['receivedCurrency'] == cur) b.remove('rate');
      if (b['bankStep'] == true) {
        b['bankStep'] = 'bank_paid_us';
      } else {
        b.remove('bankStep');
      }
      for (final k in ['bankCharges', 'reference', 'paidByName', 'note', 'accountId']) {
        if ('${b[k] ?? ''}'.isEmpty) b.remove(k);
      }
      sent = await _recordOrSubmit(
        box,
        label: joinParts(['Money received', refNo, fmtMoney('${b['receivedAmount']}', '${b['receivedCurrency']}')]),
        direct: direct,
        kind: 'payment',
        orderId: orderId,
        path: '/api/orders/$orderId/payments',
        idAt: 'createdId',
        body: b,
        file: slip,
        fileTo: (id) => '/api/payments/$id/file',
      );
      return sent!.first;
    },
  );
  if (!ok || !context.mounted) return ok;
  if (sent!.queued) {
    savedToast(context, sent!, '');
    return true;
  }
  final r = direct ? sent!.first : null;
  if (r == null) {
    toast(context, 'Sent for approval · a manager is told');
    return true;
  }
  final made = r.list('payments', (p) => p).where((p) => p.str('id') == r.str('createdId')).firstOrNull;
  final no = made == null ? null : (await paperNumbers(context.api, orderId))['payment-receipt:${made.str('id')}'];
  if (!context.mounted) return true;
  toast(
    context,
    joinParts(['Recorded', if (no != null) 'receipt $no']),
    action: made == null ? null : 'Share receipt',
    onAction: made == null
        ? null
        : () => shareReceipt(context, orderId: orderId, refNo: refNo, customerId: null, payment: made, number: no),
  );
  return true;
}

class _Summary extends StatelessWidget {
  const _Summary({required this.rows, this.note});
  final List<(String, String)> rows;
  final String? note;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.xs),
        decoration: BoxDecoration(color: c.surface2, borderRadius: BorderRadius.circular(Gap.radius)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (k, v) in rows) KvRow(k, v),
            if (note != null)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.sm),
                child: Text(
                  note!,
                  style: context.text.bodySmall?.copyWith(color: c.warn, fontWeight: FontWeight.w600),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- expense

/// A cost in ten seconds: amount, kind, what for, the receipt. Managers save it; others send it
/// to a manager. [orderId] when opened from an order.
Future<bool> openExpense(
  BuildContext context, {
  String? orderId,
  String? refNo,
  String? customer,
  List<Json> factories = const [],
}) async {
  final api = context.api;
  final direct = context.can(permExpenses);
  final me = context.session.me;
  final accounts = direct ? await _accounts(api) : const <String, Map<String, String>>{};
  String home = 'USD';
  try {
    home = (await api.get('/api/settings')).at('sales.currency') ?? 'USD';
  } on ApiException {
    // the first currency is fine
  }
  if (!context.mounted) return false;
  final factoryNames = {for (final f in factories) f.at('factory.id')!: f.at('factory.name')!};
  PickedFile? receipt;
  Sent? sent;
  final box = context.outbox;

  final ok = await FormSheet.open(
    context,
    title: 'Expense',
    save: direct ? 'Save the expense' : 'Send for approval',
    keeps: true,
    intro: joinParts([
      if (orderId == null) 'For the company (no order)' else refNo,
      customer,
      if (!direct) '\n$_approvalNote',
    ]),
    initial: {
      'currency': home,
      'amount': '',
      'spentOn': _today(),
      'borneBy': 'us',
      'ownMoney': false,
      'accountId': _lastAccount(accounts, home),
    },
    groups: [
      FormGroup(
        fields: [
          FieldDef('currency', 'Currency', FieldKind.choice, required: true, options: CurrencyEnum.labels),
          const FieldDef('amount', 'Amount', FieldKind.decimal, required: true),
          FieldDef('category', 'Kind', FieldKind.choice, required: true, options: ExpenseCategoryEnum.labels),
          const FieldDef(
            'description',
            'What for',
            FieldKind.text,
            required: true,
            max: 200,
            hint: 'Say what it was for, e.g. Taxi to the factory for the FAT',
          ),
          const FieldDef('spentOn', 'On', FieldKind.date, required: true),
          if (orderId != null)
            FieldDef(
              'borneBy',
              'Who pays',
              FieldKind.choice,
              options: factories.isEmpty
                  ? (Map.of(ExpenseBearerEnum.labels)..remove('factory'))
                  : ExpenseBearerEnum.labels,
            ),
          if (factories.length > 1)
            FieldDef(
              'factoryId',
              'Which factory',
              FieldKind.choice,
              required: true,
              options: factoryNames,
              showIf: (v) => v['borneBy'] == 'factory',
            ),
          const FieldDef('ownMoney', 'I paid it from my own money (to be repaid)', FieldKind.toggle),
          ..._accountFields(
            accounts,
            'currency',
            'Paid from',
          ).map((f) => f.copyWith(showIf: (v) => v['ownMoney'] != true && f.showIf!(v))),
        ],
      ),
      const FormGroup(
        title: 'More',
        folded: true,
        fields: [
          FieldDef('reference', 'Reference', FieldKind.text, max: 120, hint: 'Invoice or receipt number'),
          FieldDef('note', 'Note', FieldKind.multiline, max: 2000),
        ],
      ),
    ],
    onChange: (v, key) {
      if (key == 'currency') v['accountId'] = _lastAccount(accounts, v['currency'] as String);
      // The kind's name until something better is typed.
      if (key == 'category' && '${v['description'] ?? ''}'.trim().isEmpty) {
        v['description'] = ExpenseCategoryEnum.label(v['category'] as String?);
      }
    },
    extra: (setState) => FileTile(
      label: 'Receipt',
      add: 'Snap the receipt',
      picked: receipt,
      onPicked: (p) => setState(() => receipt = p),
    ),
    send: (api, body) async {
      final b = {...body, 'orderId': ?orderId};
      if (b['borneBy'] == 'factory' && factories.length == 1) b['factoryId'] = factories.first.at('factory.id');
      if (b['ownMoney'] == true) {
        b['paidById'] = me?.id;
        b.remove('accountId');
      }
      for (final k in ['reference', 'note', 'accountId']) {
        if ('${b[k] ?? ''}'.isEmpty) b.remove(k);
      }
      sent = await _recordOrSubmit(
        box,
        label: joinParts(['Expense', refNo, fmtMoney('${b['amount']}', '${b['currency']}')]),
        direct: direct,
        kind: 'expense',
        orderId: orderId,
        path: '/api/expenses',
        idAt: 'id',
        body: b,
        file: receipt,
        fileTo: (id) => '/api/expenses/$id/receipt',
      );
      return sent!.first;
    },
  );
  if (ok && context.mounted) savedToast(context, sent!, direct ? 'Expense saved' : 'Sent for approval · a manager is told');
  return ok;
}

// ---------------------------------------------------------------- paying a factory

/// Money we paid a factory (advance or balance), with the slip. People who record payments only.
Future<bool> openFactoryPayment(
  BuildContext context, {
  required String orderId,
  required String refNo,
  required Json money,
  String? factoryId,
}) async {
  final api = context.api;
  final plans = money.listAt('factories.plans');
  if (plans.isEmpty) return false;
  final plan = plans.firstWhere((p) => p.at('factory.id') == factoryId, orElse: () => plans.first);
  final accounts = await _accounts(api);
  if (!context.mounted) return false;
  final names = {for (final p in plans) p.at('factory.id')!: p.at('factory.name')!};
  Json planOf(Object? id) => plans.firstWhere((p) => p.at('factory.id') == id, orElse: () => plan);
  String kindOf(Json p) => (p.at('next.label') ?? '').toLowerCase().startsWith('balance') ? 'balance' : 'deposit';
  String openOf(Json p) => p.at('next.open') ?? p.str('toPay');
  PickedFile? slip;
  Sent? sent;
  final box = context.outbox;

  final ok = await FormSheet.open(
    context,
    title: 'Paid the factory',
    save: 'Record the payment',
    keeps: true,
    intro: joinParts([refNo, 'what we owe goes down; the plan follows']),
    initial: {
      'factoryId': plan.at('factory.id'),
      'kind': kindOf(plan),
      'amount': openOf(plan),
      'currency': plan.str('currency'),
      'paidOn': _today(),
      'method': 'bank_transfer',
      'accountId': _lastAccount(accounts, plan.str('currency')),
    },
    groups: [
      FormGroup(
        fields: [
          if (plans.length > 1) FieldDef('factoryId', 'Factory', FieldKind.choice, required: true, options: names),
          const FieldDef(
            'kind',
            'Pays',
            FieldKind.choice,
            options: {'deposit': 'Advance', 'balance': 'Balance', 'other': 'Other'},
          ),
          FieldDef('currency', 'Currency', FieldKind.choice, required: true, options: CurrencyEnum.labels),
          const FieldDef('amount', 'Amount paid', FieldKind.decimal, required: true),
          const FieldDef('paidOn', 'Paid on', FieldKind.date, required: true),
          FieldDef('method', 'How', FieldKind.choice, options: PaymentMethodEnum.labels),
          ..._accountFields(accounts, 'currency', 'Paid from'),
          const FieldDef('reference', 'Reference', FieldKind.text, max: 120),
        ],
      ),
      const FormGroup(
        title: 'More',
        folded: true,
        fields: [
          FieldDef('rate', 'Rate', FieldKind.decimal, hint: 'Left empty: the rate in Settings'),
          FieldDef('note', 'Note', FieldKind.multiline, max: 2000),
        ],
      ),
    ],
    onChange: (v, key) {
      if (key == 'factoryId') {
        final p = planOf(v['factoryId']);
        v
          ..['kind'] = kindOf(p)
          ..['amount'] = openOf(p)
          ..['currency'] = p.str('currency');
      }
      if (key == 'factoryId' || key == 'currency') v['accountId'] = _lastAccount(accounts, v['currency'] as String);
    },
    live: (v) {
      final p = planOf(v['factoryId']);
      final c = p.str('currency');
      final left = _n(p.str('toPay')) - (v['currency'] == c ? _n(v['amount']) : 0);
      return _Summary(
        rows: [
          ('To pay ${p.at('factory.name')}', fmtMoney(p.str('toPay'), c)!),
          if (v['currency'] == c) ('Left to pay after this', fmtMoney(_fixed(left < 0 ? 0 : left), c)!),
        ],
        note: left < 0 ? 'More than we owe them' : null,
      );
    },
    extra: (setState) => FileTile(
      label: 'Bank slip',
      add: 'Snap the slip or attach it',
      picked: slip,
      onPicked: (p) => setState(() => slip = p),
    ),
    send: (api, body) async {
      final b = {...body, if (plans.length == 1) 'factoryId': plan.at('factory.id')};
      for (final k in ['reference', 'note', 'accountId', 'rate']) {
        if ('${b[k] ?? ''}'.isEmpty) b.remove(k);
      }
      final ch = box.chain(joinParts(['Paid the factory', refNo, fmtMoney('${b['amount']}', '${b['currency']}')]));
      final made = ch.post('/api/orders/$orderId/factory-payments', b, idAt: 'createdId');
      if (slip != null) ch.upload('/api/factory-payments/${Chain.ref(made)}/file', slip!.bytes, slip!.name);
      sent = await ch.send();
      return sent!.first;
    },
  );
  if (ok && context.mounted) savedToast(context, sent!, 'Payment to the factory recorded');
  return ok;
}

// ---------------------------------------------------------------- sharing receipts and requests

/// The customer's main contact, for "Dear …" (null when unknown).
Future<String?> _contactName(Api api, String? customerId) async {
  if (customerId == null) return null;
  try {
    final c = await api.get('/api/customers/$customerId');
    final contacts = c.list('contacts', (m) => m);
    return (contacts.where((x) => x.boolean('isPrimary')).firstOrNull ?? contacts.firstOrNull)?.strOrNull('name');
  } on ApiException {
    return null;
  }
}

String _signature(BuildContext context) {
  final me = context.session.me;
  return joinParts([me?.name, me?.company]).replaceAll(' · ', '\n');
}

void _logShare(BuildContext context, String orderId, String key, String message) =>
    context.api.post('/api/orders/$orderId/files/share', {
      'papers': [key],
      'files': <String>[],
      'via': 'share',
      'message': message,
    }).ignore();

/// A payment's receipt as a PDF, shared with a thank-you message.
Future<void> shareReceipt(
  BuildContext context, {
  required String orderId,
  required String refNo,
  required String? customerId,
  required Json payment,
  String? number,
}) async {
  final name = await _contactName(context.api, customerId);
  if (!context.mounted) return;
  final no = number;
  final amount = fmtMoney(
    payment.strOrNull('receivedAmount') ?? payment.str('amount'),
    payment.strOrNull('receivedCurrency') ?? payment.str('currency'),
  );
  final on = payment.strOrNull('paidOn');
  await shareWithMessage(
    context,
    title: 'Share · payment receipt',
    to: name,
    file: RemoteFile(
      path: '/pdf/payment-receipt/$orderId?ref=${payment.str('id')}',
      name: '${no ?? 'Payment receipt'}.pdf',
      type: 'application/pdf',
      note: no,
    ),
    subject: joinParts(['Payment receipt', no, refNo]),
    message:
        'Dear ${name ?? 'Sir or Madam'},\n\n'
        'Thank you for your payment of $amount${on == null ? '' : ' received on ${fmtDate(DateTime.parse(on))}'} for order $refNo. '
        'Please find our receipt${no == null ? '' : ' $no'} attached.\n\n'
        'Best regards,\n${_signature(context)}',
    onShared: (msg, _) => _logShare(context, orderId, 'payment-receipt:${payment.str('id')}', msg),
  );
}

/// The payment request for one row of the plan, shared with a ready message.
Future<void> shareRequest(
  BuildContext context, {
  required String orderId,
  required String refNo,
  required String? customerId,
  required Json item,
  required String currency,
}) async {
  final name = await _contactName(context.api, customerId);
  if (!context.mounted) return;
  final label = item.str('label');
  final open = fmtMoney(item.strOrNull('open') ?? item.str('amount'), currency);
  final due = item.strOrNull('dueOn');
  await shareWithMessage(
    context,
    title: 'Share · payment request',
    to: name,
    file: RemoteFile(
      path: '/pdf/payment-request/$orderId?ref=${item.str('id')}',
      name: 'Payment request $refNo.pdf',
      type: 'application/pdf',
      note: label,
    ),
    subject: joinParts(['Payment request', label, refNo]),
    message:
        'Dear ${name ?? 'Sir or Madam'},\n\n'
        'Please find attached our payment request for the ${label.toLowerCase()} of $open on order $refNo'
        '${due == null ? '' : ', due ${fmtDate(DateTime.parse(due))}'}.\n\n'
        'Best regards,\n${_signature(context)}',
    onShared: (msg, _) => _logShare(context, orderId, 'payment-request:${item.str('id')}', msg),
  );
}

// ---------------------------------------------------------------- the order's Money section

/// The order's money: the plan and what is due, payments received (each with its receipt),
/// what waits for a manager, the customer's credit, and what we owe each factory.
class OrderMoneySection extends StatefulWidget {
  const OrderMoneySection(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  State<OrderMoneySection> createState() => _OrderMoneySectionState();
}

class _OrderMoneySectionState extends State<OrderMoneySection> {
  Json? money, pays;
  Map<String, String> numbers = const {};
  List<Json> waiting = const [];
  String? error;

  Order get o => widget.order;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (money == null && error == null) _load();
  }

  Future<void> _load() async {
    final api = context.api;
    final mayWait = context.can(permRecord) || context.can(permExpenses) || context.can(permSubmit);
    try {
      final r = await Future.wait([api.get('/api/orders/${o.id}/money'), api.get('/api/orders/${o.id}/payments')]);
      final papers = await paperNumbers(api, o.id);
      var w = const <Json>[];
      if (mayWait) {
        try {
          w = (await api.getList(
            '/api/submissions',
            query: {'status': 'pending'},
          )).where((s) => s.at('order.id') == o.id).toList();
        } on ApiException {
          // the server may not know approvals yet: nothing waits
        }
      }
      if (mounted) {
        setState(() {
          money = r[0];
          pays = r[1];
          numbers = papers;
          waiting = w;
          error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _after(Future<bool> saved) async {
    if (await saved && mounted) {
      await _load();
      if (mounted) RecordScope.reloadOf(context);
    }
  }

  Future<void> _useCredit(Json credit, String cur) async {
    final p = pays!;
    final most = [_n(credit.str('amount')), _n(p.str('due'))].reduce((a, b) => a < b ? a : b);
    await _after(
      FormSheet.open(
        context,
        title: 'Use the customer\'s credit',
        save: 'Use the credit',
        intro:
            '${o.customer?.name ?? 'The customer'} has ${fmtMoney(credit.str('amount'), cur)} credit. It pays this order now.',
        initial: {'amount': _fixed(most), 'on': _today()},
        groups: [
          FormGroup(
            fields: [
              FieldDef('amount', 'Amount ($cur)', FieldKind.decimal, required: true),
              const FieldDef('on', 'On', FieldKind.date, required: true),
            ],
          ),
        ],
        send: (api, body) => api.post('/api/orders/${o.id}/use-credit', body),
      ),
    );
  }

  Widget _heading(BuildContext context, String t) => Padding(
    padding: const EdgeInsets.only(top: Gap.md, bottom: Gap.xs),
    child: Semantics(
      header: true,
      child: Text(t, style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final m = money, p = pays;
    if (m == null || p == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.md),
                child: MessageBanner(
                  error!,
                  tone: Tone.bad,
                  action: TextButton(onPressed: _load, child: const Text('Try again')),
                ),
              ),
      );
    }
    final c = context.colors;
    final cur = m.str('currency');
    final items = m.listAt('plan.items');
    final payments = p.list('payments', (x) => x);
    final credit = p.obj('credit', (x) => x);
    final factories = m.listAt('factories.plans');
    final canPayFactory = m.boolAt('factories.canRecord');
    final nextOpen = items.where((i) => i.str('status') != 'paid').firstOrNull;
    final charged = _n(p.str('charged'));
    final cancelled = m.boolean('cancelled');

    return SectionCard(
      title: widget.title,
      action: Text(
        fmtMoney(p.str('due'), cur) == null ? '' : '${fmtMoney(p.str('due'), cur)} due',
        style: context.text.labelMedium?.copyWith(color: _n(p.str('due')) > 0 ? c.text2 : c.ok),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KvRow('Total', fmtMoney(p.str('total'), cur)!),
          if (charged > 0) KvRow('Charged to the customer', fmtMoney(p.str('charged'), cur)!),
          KvRow('Received', fmtMoney(p.str('received'), cur)!),
          KvRow('Still due', fmtMoney(p.str('due'), cur)!),
          if (m.at('route.summary') != null) KvRow('Paid by', m.at('route.summary')!),
          if (credit != null && credit.boolean('canUse')) ...[
            const SizedBox(height: Gap.sm),
            MessageBanner(
              '${o.customer?.name ?? 'The customer'} has ${fmtMoney(credit.str('amount'), cur)} credit',
              tone: Tone.info,
              action: TextButton(onPressed: () => _useCredit(credit, cur), child: const Text('Use it')),
            ),
          ],
          if (items.isNotEmpty) ...[
            _heading(context, 'The plan'),
            for (final (i, it) in items.indexed)
              PhoneRow(
                RowData(
                  title: it.str('label'),
                  sub: [
                    fmtMoney(it.str('amount'), cur),
                    if (_n(it.str('paid')) > 0 && it.str('status') != 'paid') '${fmtMoney(it.str('paid'), cur)} paid',
                    _dueText(it),
                  ],
                  badge: PlanStatusEnum.badge(it.str('status')),
                  trailing: it.str('status') == 'paid'
                      ? null
                      : Icon(Icons.ios_share, size: 18, color: c.text2, semanticLabel: 'Share the payment request'),
                  onTap: it.str('status') == 'paid'
                      ? null
                      : () => shareRequest(
                          context,
                          orderId: o.id,
                          refNo: o.refNo ?? '',
                          customerId: o.customer?.id,
                          item: it,
                          currency: cur,
                        ),
                ),
                divider: i < items.length - 1,
              ),
            if (m.boolAt('plan.canEdit'))
              Text('The plan is changed on the web.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ],
          if (waiting.isNotEmpty) ...[
            _heading(context, 'Waiting for a manager · ${waiting.length}'),
            for (final (i, s) in waiting.indexed)
              PhoneRow(
                RowData(
                  title: submissionTitle(s),
                  sub: [s.at('submittedBy.name'), fmtShortDay(s.strOrNull('submittedAt'))],
                  badge: const Badge('Waiting', Tone.warn),
                  onTap: canApprove(context, s) ? () => _after(openApproval(context, s)) : null,
                ),
                divider: i < waiting.length - 1,
              ),
          ],
          _heading(context, payments.isEmpty ? 'No payments received yet' : 'Payments received · ${payments.length}'),
          for (final (i, pay) in payments.indexed)
            PhoneRow(
              RowData(
                title: joinParts([
                  fmtShortDay(pay.strOrNull('paidOn')),
                  fmtMoney(
                    pay.strOrNull('receivedAmount') ?? pay.str('amount'),
                    pay.strOrNull('receivedCurrency') ?? cur,
                  ),
                ]),
                sub: [
                  PaymentMethodEnum.label(pay.strOrNull('method')),
                  numbers['payment-receipt:${pay.str('id')}'],
                  pay.at('recordedBy.name'),
                ],
                badge: pay['voided'] != null ? const Badge('Removed', Tone.neutral) : null,
                trailing: pay['voided'] != null
                    ? null
                    : Icon(Icons.ios_share, size: 18, color: c.text2, semanticLabel: 'Share the receipt'),
                onTap: pay['voided'] != null
                    ? null
                    : () => shareReceipt(
                        context,
                        orderId: o.id,
                        refNo: o.refNo ?? '',
                        customerId: o.customer?.id,
                        payment: pay,
                        number: numbers['payment-receipt:${pay.str('id')}'],
                      ),
              ),
              divider: i < payments.length - 1,
            ),
          if (!cancelled) ...[
            const SizedBox(height: Gap.md),
            Wrap(
              spacing: Gap.sm,
              runSpacing: Gap.sm,
              children: [
                if (canAddMoney(context))
                  FilledButton.icon(
                    onPressed: () => _after(
                      openMoneyReceived(context, orderId: o.id, refNo: o.refNo ?? '', customer: o.customer?.name),
                    ),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Money received'),
                  ),
                if (nextOpen != null)
                  OutlinedButton(
                    onPressed: () => shareRequest(
                      context,
                      orderId: o.id,
                      refNo: o.refNo ?? '',
                      customerId: o.customer?.id,
                      item: nextOpen,
                      currency: cur,
                    ),
                    child: const Text('Payment request'),
                  ),
                if (canAddExpense(context))
                  OutlinedButton(
                    onPressed: () => _after(
                      openExpense(
                        context,
                        orderId: o.id,
                        refNo: o.refNo,
                        customer: o.customer?.name,
                        factories: m.listAt('factories.rows'),
                      ),
                    ),
                    child: const Text('Expense'),
                  ),
              ],
            ),
          ],
          for (final f in factories) ..._factory(context, f, canPayFactory && !cancelled),
        ],
      ),
    );
  }

  List<Widget> _factory(BuildContext context, Json f, bool canPay) {
    final cur = f.str('currency');
    final rows = f.list('rows', (x) => x);
    return [
      _heading(context, 'What we owe ${f.at('factory.name')}'),
      KvRow('Owed (with tax)', fmtMoney(f.str('owed'), cur)!),
      KvRow('Paid', fmtMoney(f.str('paid'), cur)!),
      if (_n(f.str('takenOff')) > 0) KvRow('Taken off (their costs)', fmtMoney(f.str('takenOff'), cur)!),
      KvRow('To pay', fmtMoney(f.str('toPay'), cur)!),
      for (final (i, r) in rows.indexed)
        PhoneRow(
          RowData(
            title: r.str('label'),
            sub: [fmtMoney(r.str('amount'), cur), _dueText(r)],
            badge: PlanStatusEnum.badge(r.str('status')),
          ),
          divider: i < rows.length - 1,
        ),
      if (canPay && _n(f.str('toPay')) > 0)
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () => _after(
              openFactoryPayment(
                context,
                orderId: o.id,
                refNo: o.refNo ?? '',
                money: money!,
                factoryId: f.at('factory.id'),
              ),
            ),
            icon: const Icon(Icons.payments_outlined, size: 18),
            label: const Text('Paid the factory'),
          ),
        ),
    ];
  }
}

/// "28 Oct" for a date or a time from the server.
String? fmtShortDay(String? iso) {
  final d = iso == null ? null : DateTime.tryParse(iso);
  return d == null ? null : DateFormat('d MMM').format(d.toLocal());
}

// ---------------------------------------------------------------- approvals

/// "Money received · USD 24,202.72" / "Expense · Inland transport · CNY 320".
String submissionTitle(Json s) {
  final kind = s.str('kind');
  final amount = fmtMoney(s.strOrNull('amount'), s.strOrNull('currency'));
  return kind == 'payment'
      ? joinParts(['Money received', amount])
      : joinParts(['Expense', ExpenseCategoryEnum.label(s.strOrNull('category')), amount]);
}

/// Whether this person approves [s]: money received needs payments.record, expenses expenses.manage.
bool canApprove(BuildContext context, Json s) => context.can(s.str('kind') == 'payment' ? permRecord : permExpenses);

/// One thing waiting: what it is, the photo, and Approve / Send back. True when decided.
Future<bool> openApproval(BuildContext context, Json s) async {
  final decided = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    builder: (_) => _ApprovalSheet(s),
  );
  return decided ?? false;
}

class _ApprovalSheet extends StatefulWidget {
  const _ApprovalSheet(this.s);
  final Json s;

  @override
  State<_ApprovalSheet> createState() => _ApprovalSheetState();
}

class _ApprovalSheetState extends State<_ApprovalSheet> {
  bool busy = false;
  String? problem;

  Json get s => widget.s;

  Future<void> _approve() async {
    if (!needsConnection(context)) return;
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      await context.api.post('/api/submissions/${s.str('id')}/approve');
      if (!mounted) return;
      toast(context, s.str('kind') == 'payment' ? 'Approved · the receipt is made' : 'Approved · it counts now');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          problem = e.message;
        });
      }
    }
  }

  Future<void> _sendBack() async {
    if (!needsConnection(context)) return;
    final why = await askText(
      context,
      title: 'Send it back',
      label: 'Why',
      hint: 'They see this and can fix it',
      suggestions: const ['Wrong amount', 'No photo of the slip', 'Wrong order', 'Not ours to pay'],
    );
    if (why == null || !mounted) return;
    setState(() => busy = true);
    try {
      await context.api.post('/api/submissions/${s.str('id')}/send-back', {'reason': why});
      if (!mounted) return;
      toast(context, 'Sent back to ${s.at('submittedBy.name') ?? 'them'}');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          problem = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final b = s.obj('body', (x) => x) ?? const <String, Object?>{};
    final payment = s.str('kind') == 'payment';
    final pairs = <(String, String?)>[
      ('Order', joinParts([s.at('order.refNo'), s.at('order.customer')])),
      if (payment) ...[
        ('Received on', fmtShortDay(b['paidOn'] as String?)),
        ('How', PaymentMethodEnum.label(b['method'] as String?)),
        ('Reference', b['reference'] as String?),
        ('Paid by', b['paidByName'] as String?),
      ] else ...[
        ('What for', b['description'] as String?),
        ('On', fmtShortDay(b['spentOn'] as String?)),
        ('Who pays', ExpenseBearerEnum.label(b['borneBy'] as String?)),
        ('Paid from', b['ownMoney'] == true ? 'Their own money (to repay)' : null),
      ],
      ('Note', b['note'] as String?),
      ('Added by', joinParts([s.at('submittedBy.name'), fmtShortDay(s.strOrNull('submittedAt'))])),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(header: true, child: Text(submissionTitle(s), style: context.text.titleLarge)),
              ),
              IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: () => Navigator.pop(context)),
            ],
          ),
          Text('Counts once approved', style: context.text.bodySmall?.copyWith(color: c.text2)),
          const SizedBox(height: Gap.md),
          if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.md)],
          for (final (k, v) in pairs)
            if (v != null && v.isNotEmpty) KvRow(k, v),
          if (s.boolean('hasFile')) ...[
            const SizedBox(height: Gap.sm),
            OutlinedButton.icon(
              onPressed: () => openFile(
                context,
                RemoteFile(
                  path: '/api/submissions/${s.str('id')}/file',
                  name: payment ? 'Bank slip' : 'Receipt',
                  note: payment ? 'Bank slip' : 'Receipt',
                ),
              ),
              icon: const Icon(Icons.image_outlined, size: 18),
              label: Text(payment ? 'See the bank slip' : 'See the receipt'),
            ),
          ] else
            Padding(
              padding: const EdgeInsets.only(top: Gap.sm),
              child: Text(
                payment ? 'No slip attached' : 'No receipt attached',
                style: context.text.bodySmall?.copyWith(color: c.warn),
              ),
            ),
          const SizedBox(height: Gap.lg),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(onPressed: busy ? null : _sendBack, child: const Text('Send back…')),
              ),
              const SizedBox(width: Gap.sm),
              Expanded(
                child: FilledButton(
                  onPressed: busy ? null : _approve,
                  child: busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A few words from the person (a reason), with quick choices. Null when cancelled.
Future<String?> askText(
  BuildContext context, {
  required String title,
  required String label,
  String? hint,
  List<String> suggestions = const [],
}) {
  final ctl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: ctx.text.titleMedium),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: Gap.sm,
              runSpacing: Gap.xs,
              children: [for (final s in suggestions) ActionChip(label: Text(s), onPressed: () => ctl.text = s)],
            ),
            const SizedBox(height: Gap.sm),
            TextField(
              controller: ctl,
              maxLength: 500,
              autofocus: suggestions.isEmpty,
              decoration: InputDecoration(labelText: label, helperText: hint),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        FilledButton(
          onPressed: () => ctl.text.trim().isEmpty ? null : Navigator.pop(ctx, ctl.text.trim()),
          child: Text(title),
        ),
      ],
    ),
  ).whenComplete(ctl.dispose);
}
