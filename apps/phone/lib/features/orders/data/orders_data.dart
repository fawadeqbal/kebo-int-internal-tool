import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

/// "Confirmed", "In production", "Shipped", "Arrived", "Delivered", "Done", "Cancelled":
/// where an order stands in one word, as the web shows it.
abstract final class OrderWord {
  static const order = ['Confirmed', 'In production', 'Shipped', 'Arrived', 'Delivered', 'Done'];
  static KTone tone(String? w) => switch (w) {
    'Confirmed' => KTone.neutral,
    'In production' => KTone.info,
    'Shipped' || 'Arrived' => KTone.info,
    'Delivered' || 'Done' => KTone.success,
    'Cancelled' => KTone.neutral,
    _ => KTone.neutral,
  };
  static KBadge badge(String? w) => KBadge(w ?? '', tone: tone(w));
}

KTone toneOf(String? t) => switch (t) {
  'ok' => KTone.success,
  'info' => KTone.info,
  'warn' => KTone.warning,
  'bad' => KTone.danger,
  _ => KTone.neutral,
};

class OrderRow {
  const OrderRow(this.j);
  final Json j;
  String get id => j.str('id');
  String get refNo => j.str('refNo');
  String? get word => j.strOrNull('word');
  String? get customer => j.at('customer.name');
  String? get what => j.at('inquiry.title') ?? j.at('inquiry.category');
  String? get currency => j.strOrNull('currency');
  String? get total => j.strOrNull('total');
  String? get due => j.strOrNull('due');
  String? get needs => j.at('needs.title');
  String? get needsDue => j.at('needs.due');
  bool get late => j.boolAt('needs.late');
  List<String> get purchaseOrders => [for (final p in (j['purchaseOrders'] as List<dynamic>? ?? const [])) '$p'];
}

class OrderFilter {
  const OrderFilter({this.status = 'open', this.stage, this.q = '', this.mine = false});
  final String status, q;
  final String? stage;
  final bool mine;
  OrderFilter copyWith({String? status, String? stage, bool clearStage = false, String? q, bool? mine}) => OrderFilter(
    status: status ?? this.status,
    stage: clearStage ? null : stage ?? this.stage,
    q: q ?? this.q,
    mine: mine ?? this.mine,
  );
  @override
  bool operator ==(Object other) =>
      other is OrderFilter && other.status == status && other.stage == stage && other.q == q && other.mine == mine;
  @override
  int get hashCode => Object.hash(status, stage, q, mine);
}

class OrderPage {
  const OrderPage(this.rows, {required this.total, required this.counts});
  final List<OrderRow> rows;
  final int total;
  final Map<String, int> counts;
}

Future<OrderPage> fetchOrders(Api api, OrderFilter f, int page) async {
  final j = await api.get(
    '/api/orders/page',
    query: {
      'status': f.status,
      'stage': ?f.stage,
      if (f.q.trim().isNotEmpty) 'q': f.q.trim(),
      if (f.mine) 'mine': 'true',
      'page': page,
      'pageSize': 50,
    },
  );
  return OrderPage(
    j.list('rows', OrderRow.new),
    total: j.integer('total'),
    counts: {
      for (final e in (j['counts'] as Map<String, dynamic>? ?? const {}).entries)
        if (e.value is num) e.key: (e.value as num).toInt(),
    },
  );
}

final ordersProvider = FutureProvider.autoDispose.family<OrderPage, OrderFilter>((ref, f) async {
  return fetchOrders(ref.watch(sessionProvider.notifier).api, f, 1);
});

/// The order with where each of its stages stands, its papers and its files.
class OrderView {
  const OrderView(this.o, this.stands, this.papers, this.files);
  final Json o;
  final List<Json> stands, papers, files;

  String get id => o.str('id');
  String get refNo => o.str('refNo');
  String? get word => o.strOrNull('word');
  String? get status => o.strOrNull('status');
  String? get customer => o.at('customer.name');
  String? get what => o.at('inquiry.title') ?? o.at('inquiry.category');
  String? get inquiryId => o.at('inquiry.id');
  String? get currency => o.strOrNull('currency');
  String? get total => o.at('money.total') ?? o.strOrNull('total');
  String? get received => o.at('money.received') ?? o.strOrNull('received');
  String? get due => o.at('money.due') ?? o.strOrNull('due');
  String? get deposit => o.at('money.deposit');
  int get depositPercent => o.objAt('money')?.integer('depositPercent') ?? 0;
  String? get bankCharges => o.at('money.bankCharges');
  String? get needs => o.at('needs.title');
  String? get needsDue => o.at('needs.due');
  bool get late => o.boolAt('needs.late');
  String? get next => o.at('next.label');
  String? get nextHint => o.at('next.hint');
  List<Json> get lines => o.list('lines', (m) => m);
}

final orderProvider = FutureProvider.autoDispose.family<OrderView, String>((ref, id) async {
  final api = ref.watch(sessionProvider.notifier).api;
  Future<Json> soft(String p) =>
      api.get(p).catchError((Object _) => <String, dynamic>{}, test: (e) => e is ApiException && !e.offline);
  final r = await Future.wait([
    api.get('/api/orders/$id'),
    soft('/api/orders/$id/sections'),
    soft('/api/orders/$id/papers'),
    soft('/api/orders/$id/files'),
  ]);
  return OrderView(r[0], r[1].list('stands', (m) => m), r[2].list('papers', (m) => m), r[3].list('files', (m) => m));
});
