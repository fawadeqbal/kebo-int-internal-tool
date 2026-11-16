import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/json.dart';
import '../../../core/providers.dart';

/// Recording money needs one of these; without it, a manager approves what is sent.
const permRecord = 'payments.record';
const permExpenses = 'expenses.manage';

class Account {
  const Account(this.j);
  final Json j;
  String get id => j.str('id');
  String get name => j.str('name');
  String get kind => j.str('kind');
  String get currency => j.str('currency');
  String? get balance => j.strOrNull('balance');
}

final accountsProvider = FutureProvider.autoDispose<List<Account>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return [
    for (final a in await api.getList('/api/money/accounts'))
      if (a['archived'] != true) Account(a),
  ];
});

/// What we still owe each factory.
final payablesProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return api.getList('/api/money/payables');
});

/// Open orders with money still due, most due first.
final toCollectProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  final rows = (await api.get('/api/orders/page', query: {'status': 'open', 'pageSize': 100})).list('rows', (m) => m);
  final due = rows.where((r) => (num.tryParse(r.str('due')) ?? 0) > 0).toList()
    ..sort((a, b) => (num.tryParse(b.str('due')) ?? 0).compareTo(num.tryParse(a.str('due')) ?? 0));
  return due;
});

final homeCurrencyProvider = FutureProvider.autoDispose<String>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return (await api.get('/api/settings')).at('sales.currency') ?? 'USD';
});

abstract final class PaymentMethod {
  static const labels = {
    'bank_transfer': 'Bank transfer',
    'cash': 'Cash',
    'cheque': 'Cheque',
    'online': 'Online',
    'letter_of_credit': 'Letter of credit',
    'other': 'Other',
  };
}

abstract final class ExpenseCategory {
  static const labels = {
    'travel': 'Travel',
    'hotel': 'Hotel',
    'meals': 'Meals',
    'gifts': 'Gifts',
    'samples': 'Samples',
    'freight': 'Freight',
    'inland_transport': 'Inland transport',
    'inspection': 'Inspection',
    'customs': 'Customs',
    'insurance': 'Insurance',
    'courier': 'Courier',
    'bank_charges': 'Bank charges',
    'commission': 'Commission',
    'rent': 'Rent',
    'salaries': 'Salaries',
    'utilities': 'Utilities',
    'office': 'Office',
    'other': 'Other',
  };
}
