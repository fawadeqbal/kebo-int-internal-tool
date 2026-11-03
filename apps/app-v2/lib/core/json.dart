/// A JSON object from the API.
typedef Json = Map<String, dynamic>;

/// Typed reads that never throw on a missing or null key: models stay simple
/// and an older server that leaves a field out still loads.
extension JsonRead on Json {
  String str(String k, [String fallback = '']) => switch (this[k]) { String s => s, num n => '$n', _ => fallback };

  String? strOrNull(String k) => switch (this[k]) { String s when s.isNotEmpty => s, num n => '$n', _ => null };

  int integer(String k) => switch (this[k]) { int n => n, num n => n.toInt(), String s => int.tryParse(s) ?? 0, _ => 0 };

  bool boolean(String k) => this[k] == true;

  /// A text deeper in: `o.at('customer.name')`; null when any step is missing.
  String? at(String path) => switch (_walk(path)) { String s when s.isNotEmpty => s, num n => '$n', _ => null };

  /// The list deeper in: `flow.listAt('shipping.shipments')`.
  List<Json> listAt(String path) => switch (_walk(path)) { List<dynamic> l => [for (final e in l) if (e is Map<String, dynamic>) e], _ => const [] };

  /// Follows map keys and list positions: "shipping.shipments.0.blNo".
  Object? _walk(String path) {
    Object? v = this;
    for (final p in path.split('.')) {
      v = switch (v) { Map<String, dynamic> m => m[p], List<dynamic> l => int.tryParse(p) is int && int.parse(p) < l.length ? l[int.parse(p)] : null, _ => null };
    }
    return v;
  }

  DateTime? date(String k) => switch (this[k]) { String s => DateTime.tryParse(s), _ => null };

  T? obj<T>(String k, T Function(Json) read) => switch (this[k]) { Map<String, dynamic> m => read(m), _ => null };

  List<T> list<T>(String k, T Function(Json) read) =>
      switch (this[k]) { List<dynamic> l => [for (final e in l) if (e is Map<String, dynamic>) read(e)], _ => const [] };
}

/// "2026-10-28" for a date field sent to the API.
String? isoDay(DateTime? d) => d?.toIso8601String().substring(0, 10);

/// One page of a list endpoint: `{ total, page, pageSize, rows }`.
class Paged<T> {
  const Paged(this.rows, {required this.total, required this.page, required this.pageSize, this.counts = const {}});

  factory Paged.fromJson(Json j, T Function(Json) read) => Paged(
        j.list('rows', read),
        total: j.integer('total'),
        page: j.integer('page'),
        pageSize: j.integer('pageSize'),
        counts: {for (final e in (j['counts'] as Map<String, dynamic>? ?? const {}).entries) if (e.value is num) e.key: (e.value as num).toInt()},
      );

  /// How many there are of each kind (`{ quoted: 4, won: 153 }`), for the filter chips.
  final Map<String, int> counts;

  /// An endpoint that answers with every row at once.
  factory Paged.all(List<T> rows) => Paged(rows, total: rows.length, page: 1, pageSize: rows.length);

  final List<T> rows;
  final int total, page, pageSize;

  bool get hasMore => page * pageSize < total;
}
